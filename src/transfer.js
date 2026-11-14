// Copying and moving files: the `collisions` question, `transfer` and `transfercancel`
// (docs/protocol.md). Upstream: src/backend/transfer*.rs and ops.rs.
//
// Ported: copy and move of files, folders and symlinks, each target created exclusively; a
// cross-drive move copies and then removes the source; per-drive queueing; progress; cancel,
// which removes what the item in flight had written; the collide words keep, skip and refuse;
// fsync onto FAT-family drives; `replace`, which moves the item already there to flea's Trash
// first and puts it back when the transfer fails; `merge` with `mergecollisions`' second question.
// Not yet: undo's journal, `fatnames`, and fifos, sockets and device nodes, which are refused
// rather than opened.
import {trashRecord,forgetTrashRecord} from './trash-record.js';
import { trashOne } from "./trash.js";
import { constants, promises as fsp, lstatSync, statSync, accessSync, readdirSync, readlinkSync, realpathSync, renameSync, unlinkSync } from "node:fs";
import { basename, dirname, join, relative, resolve, isAbsolute, sep } from "node:path";
import { fsTypeOf } from "./fsinfo.js";
import { describeKind } from "./kinds.js";
import { capturedPaths, captureSelection, selectionItemUnchanged } from "./menu.js";

const WORDS = new Set(["keep", "replace", "skip", "refuse", "merge"]);
// A merge's second answer, for names inside the folders it folds together: no merge of its own.
const INNER = new Set(["keep", "replace", "skip", "refuse"]);
const LINK_LIMIT = 40;
const FAT = new Set(["vfat", "exfat", "fat", "fat12", "fat16", "fat32", "msdos", "ntfs", "ntfs3"]);
const CHUNK = 1 << 20,
  WINDOW = 150,
  NAME_TRIES = 1000,
  REFUSED_CAP = 100;

class Cancelled extends Error {}

// ---- sources and destinations ----

// The paths a request names: `paths` wins, else `rows` against the listing in force.
export function sources(request, listing, stamp, command) {
  // A menu's Copy to and Move to run on the selection its snapshot captured.
  // A menu id is a positive count; the keyboard path sends 0 for "not from a menu".
  if (request.menuId && command !== "paths") {
    const captured = capturedPaths(request.menuId);
    if (!captured) return { stale: { t: "error", where: command, path: "", msg: "Selected items changed; reopen the menu." } };
    return { paths: captured };
  }
  if (Array.isArray(request.paths) && request.paths.length) return { paths: request.paths.map(String) };
  if (Array.isArray(request.rows)) {
    if (request.listing !== undefined && request.listing !== stamp)
      return { stale: { t: "error", where: "stale", path: command, msg: "the listing changed; read the rows again" } };
    const paths = [];
    for (const index of request.rows) {
      const row = listing?.rows[index];
      if (row) paths.push(row.trash?.file ?? join(listing.path || ".", row.name));
    }
    return { paths };
  }
  return { paths: [] };
}

function destProblem(dest) {
  if (typeof dest !== "string" || !isAbsolute(dest)) return "the destination is not an absolute folder";
  let st;
  try {
    st = statSync(dest);
  } catch {
    return "the destination folder does not exist";
  }
  if (!st.isDirectory()) return "the destination is not a folder";
  try {
    accessSync(dest, constants.W_OK);
  } catch {
    return "the destination folder cannot be written";
  }
  return "";
}

// What a name holds: device, inode and file type, and birth time where the filesystem keeps one.
const identity = (st) => `${st.dev}:${st.ino}:${st.mode & constants.S_IFMT}:${st.birthtimeMs || 0}`;
const lstatOrNull = (path) => {
  try {
    return lstatSync(path);
  } catch {
    return null;
  }
};
const sameFolder = (path, dest) => resolve(dirname(path)) === resolve(dest);

// "backup.tar.zst" -> "backup.tar copy.zst", then "backup.tar copy 2.zst"; a dotfile keeps its whole name as the stem.
export function copyName(name, n) {
  const suffix = n <= 1 ? " copy" : ` copy ${n}`,
    dot = name.lastIndexOf(".");
  return dot > 0 ? `${name.slice(0, dot)}${suffix}${name.slice(dot)}` : `${name}${suffix}`;
}

function freeCopyPath(dest, name) {
  for (let n = 1; n <= NAME_TRIES; n++) {
    const candidate = join(dest, copyName(name, n));
    if (!lstatOrNull(candidate)) return candidate;
  }
  return null;
}

// ---- the collisions question ----

// The latest question: its id, its destination and, per colliding source, what its name held.
let question = null;

export function collisions(request, send, listing, stamp) {
  question = null;
  const named = sources(request, listing, stamp, "collisions");
  if (named.stale) return send(!request.menuId ? named.stale : { t: "collisions", id: request.id ?? 0, total: 0, names: [], mergeable: false });
  const id = request.id ?? 0,
    dest = request.dest,
    held = new Map(),
    names = [];
  let total = 0,
    mergeable = false;
  if (!destProblem(dest)) {
    for (const path of named.paths) {
      if (!isAbsolute(path) || sameFolder(path, dest)) continue;
      const source = lstatOrNull(path);
      if (!source) continue;
      const there = lstatOrNull(join(dest, basename(path)));
      if (!there) continue;
      total++;
      held.set(path, identity(there));
      // lstat on both sides: a link to a folder is replaced or kept, never merged through.
      mergeable ||= source.isDirectory() && there.isDirectory();
      if (names.length < 3) {
        const name = basename(path),
          dir = source.isDirectory();
        names.push({ n: name, d: dir, i: describeKind(name, dir, source.mode, undefined).icon });
      }
    }
  }
  question = { id, dest: typeof dest === "string" ? resolve(dest) : "", held,
    menuId: request.menuId, selection: !request.menuId ? null : captureSelection(request.menuId) };
  send({ t: "collisions", id, total, names, mergeable });
}

const nameEntry = (name, st) => ({ n: name, d: st.isDirectory(), i: describeKind(name, st.isDirectory(), st.mode, undefined).icon });

// After the first card answered Merge: one read-only walk of each folder that merges, gathering
// every relative name both sides hold except folders that merge further down. It follows the
// `collisions` question just kept and folds only the names that question saw, still unchanged.
export function mergeCollisions(request, send, listing, stamp) {
  const outer = question;
  question = null;
  const id = request.id ?? 0,
    dest = request.dest,
    reply = (total, names) => send({ t: "mergecollisions", id, total, names });
  const matches = !!outer && typeof dest === "string" && outer.dest === resolve(dest) && outer.menuId === request.menuId;
  const selection = !request.menuId ? null : matches ? outer.selection : captureSelection(request.menuId);
  const named = request.menuId && selection ? { paths: selection.paths } : sources(request, listing, stamp, "mergecollisions");
  if (named.stale) return request.menuId ? reply(0, []) : send(named.stale);
  const held = matches ? outer.held : new Map(),
    inner = new Map(),
    names = [];
  let total = 0;
  const note = (rel, source, there, name) => {
    total++;
    inner.set(rel, identity(there));
    if (names.length < 3) names.push(nameEntry(name, source));
  };
  const walk = (src, dst, rel) => {
    let entries;
    try {
      entries = readdirSync(src);
    } catch {
      return;
    }
    for (const entry of entries) {
      const source = lstatOrNull(join(src, entry)), there = source && lstatOrNull(join(dst, entry));
      if (!there) continue;
      if (source.isDirectory() && there.isDirectory()) walk(join(src, entry), join(dst, entry), join(rel, entry));
      else note(join(rel, entry), source, there, entry);
    }
  };
  if (!destProblem(dest)) {
    for (const path of named.paths) {
      if (!isAbsolute(path) || sameFolder(path, dest)) continue;
      const source = lstatOrNull(path), name = basename(path), there = source && lstatOrNull(join(dest, name));
      if (!there || held.get(path) !== identity(there)) continue;
      if (source.isDirectory() && there.isDirectory()) walk(path, join(dest, name), name);
      else note(name, source, there, name);
    }
  }
  question = { id, dest: typeof dest === "string" ? resolve(dest) : "", held, inner,
    menuId: request.menuId, selection: outer && matches ? outer.selection : selection };
  reply(total, names);
}

// ---- replacing ----

// Why the item at `target` may not go to Trash for `src`, or "" when it may.
function replaceProblem(src, source, target, paths) {
  const there = resolve(target);
  for (const path of paths) {
    const full = resolve(path);
    if (full === there || full.startsWith(there + sep)) return "the item already there holds the one being moved in, so it was not replaced";
  }
  if (source.isSymbolicLink() && linkLeadsTo(src, target)) return "the incoming link points at the item already there, so it was not replaced";
  return "";
}

// Whether the link at `src`, once it sits at `target`, would name `target` itself: now, or by its
// own text looked up from there through any other link on the way. Past LINK_LIMIT links it is let
// through like a dangling link, which the kernel refuses anyway.
function linkLeadsTo(src, target) {
  const there = resolve(target);
  try {
    const now = statSync(src), held = statSync(there);
    if (now.dev === held.dev && now.ino === held.ino) return true;
  } catch {}
  let text;
  try {
    text = readlinkSync(src);
  } catch {
    return false;
  }
  let at = resolve(dirname(there), text);
  for (let hops = 0; hops < LINK_LIMIT; hops++) {
    let parent = dirname(at);
    try {
      parent = realpathSync(parent);
    } catch {}
    at = join(parent, basename(at));
    if (at === there) return true;
    let st;
    try {
      st = lstatSync(at);
    } catch {
      return false;
    }
    if (!st.isSymbolicLink()) return false;
    at = resolve(dirname(at), readlinkSync(at));
  }
  return false;
}

// Puts a replaced item back from the Trash; "" when it is back, else why it stays there.
function putBack(trashed, target) {
  if (lstatOrNull(target)) return "a new item now has its name";
  try {
    renameSync(trashed.file, target);
  } catch (e) {
    return reason(e);
  }
  try {
    unlinkSync(trashed.info);
  } catch {}
  return "";
}

const stillInTrash = (err, why) => `${err}; the item it replaced is still in the Trash (${why})`;

// ---- copying ----

export const reason = (e) =>
  e instanceof Cancelled
    ? "cancelled"
    : ({
        EACCES: "permission denied",
        EPERM: "permission denied",
        ENOSPC: "the drive is full",
        EDQUOT: "the drive is full",
        EEXIST: "an item with that name is already there",
        ENOENT: "it no longer exists",
        EROFS: "the drive is read-only",
        EINVAL: "this drive does not allow that name",
        EILSEQ: "this drive does not allow that name",
        ENAMETOOLONG: "that name is too long for this drive",
      }[e?.code] ?? String(e?.message ?? e));

// An entry the destination drive refuses for that entry alone: recorded, and the walk goes on.
function refusedEntry(e, kind, fat) {
  const code = e?.code;
  if (kind === "link" && (code === "EOPNOTSUPP" || code === "ENOSYS" || (code === "EPERM" && fat))) return "this drive cannot hold links";
  if (code === "EINVAL" || code === "EILSEQ") return "this drive does not allow that name";
  if (code === "ENAMETOOLONG") return "that name is too long for this drive";
  return "";
}

class Job {
  constructor(id, send) {
    this.id = id;
    this.send = send;
    this.cancelled = false;
    this.lastWindow = 0;
  }
  check() {
    if (this.cancelled) throw new Cancelled();
  }
  progress(index, name, bytes, total, last = false) {
    const now = performance.now();
    if (!last && now - this.lastWindow < WINDOW) return;
    this.lastWindow = now;
    this.send({ t: "transferprogress", id: this.id, index, name, bytes, total });
  }
}

// One item and everything under it, into `dst`, which must not exist yet.
async function copyAny(src, dst, ctx, top = false) {
  ctx.job.check();
  const st = await fsp.lstat(src);
  if (st.isSymbolicLink()) {
    const text = await fsp.readlink(src);
    // The type says whether the link names a folder; Windows needs it, every other system ignores it.
    let type = "file";
    try { if (statSync(resolve(dirname(src), text)).isDirectory()) type = "dir"; } catch {}
    return guarded(() => fsp.symlink(text, dst, type), dst, "link", ctx, top);
  }
  if (st.isDirectory()) {
    const made = await guarded(() => fsp.mkdir(dst, { mode: st.mode & 0o7777 | 0o700 }), dst, "dir", ctx, top);
    if (made === false) return;
    ctx.made.add(dst);
    for (const entry of await fsp.readdir(src)) await copyAny(join(src, entry), join(dst, entry), ctx);
    await fsp.chmod(dst, st.mode & 0o7777).catch(() => {});
    await fsp.utimes(dst, st.atime, st.mtime).catch(() => {});
    if (ctx.durable) await fsyncPath(dst, ctx);
    return;
  }
  if (!st.isFile()) {
    // A fifo, socket or device node has no contents to stream, and opening one could wait forever.
    const err = "special files are not copied yet";
    if (top) throw Object.assign(Error(err), { sentence: err });
    if (ctx.refused.length < REFUSED_CAP) ctx.refused.push({ name: relative(ctx.root, dst), err });
    ctx.refusedCount++;
    return;
  }
  const out = await guarded(() => fsp.open(dst, "wx", st.mode & 0o7777), dst, "file", ctx, top);
  if (out === false) return;
  ctx.made.add(dst);
  const input = await fsp.open(src, "r");
  try {
    const buffer = Buffer.allocUnsafe(CHUNK);
    let done = 0;
    if (top) ctx.job.progress(ctx.index, ctx.name, 0, st.size);
    for (;;) {
      ctx.job.check();
      const { bytesRead } = await input.read(buffer, 0, CHUNK, null);
      if (!bytesRead) break;
      let written = 0;
      while (written < bytesRead) written += (await out.write(buffer, written, bytesRead - written)).bytesWritten;
      done += bytesRead;
      if (top) ctx.job.progress(ctx.index, ctx.name, done, st.size);
    }
    if (ctx.durable) await out.sync();
    if (top) ctx.job.progress(ctx.index, ctx.name, done, st.size, true);
  } finally {
    await input.close();
    await out.close();
  }
  await fsp.utimes(dst, st.atime, st.mtime).catch(() => {});
}

// Runs one create; an entry the drive refuses inside a tree is recorded and answers false.
async function guarded(create, dst, kind, ctx, top) {
  try {
    return await create();
  } catch (e) {
    const refused = top ? "" : refusedEntry(e, kind, ctx.fat);
    if (!refused) throw e;
    if (ctx.refused.length < REFUSED_CAP) ctx.refused.push({ name: relative(ctx.root, dst), err: refused });
    ctx.refusedCount++;
    return false;
  }
}

async function fsyncPath(path, ctx) {
  let handle;
  try {
    handle = await fsp.open(path, "r");
    await handle.sync();
  } catch {
    ctx.unconfirmed = true;
  } finally {
    await handle?.close().catch(() => {});
  }
}

// Same drive: one rename. Another drive: a whole copy first, and only then the source goes.
async function move(src, dst, ctx) {
  // rename(2) replaces a file silently, and so does Windows' MoveFileEx, so the name is checked first.
  if (lstatOrNull(dst)) throw Object.assign(Error("exists"), { code: "EEXIST" });
  const refusedBefore = ctx.refusedCount;
  try {
    await fsp.rename(src, dst);
    if (ctx.durable) {
      await fsyncPath(dirname(dst), ctx);
      await fsyncPath(dirname(src), ctx);
    }
    return;
  } catch (e) {
    if (e.code !== "EXDEV") throw e;
  }
  await copyAny(src, dst, ctx, true);
  if (ctx.refusedCount > refusedBefore) return;
  await fsp.rm(src, { recursive: true, force: false });
}

function refuseEntry(ctx, path, err) {
  if (ctx.refused.length < REFUSED_CAP) ctx.refused.push({ name: relative(ctx.root, path), err });
  ctx.refusedCount++;
}

// Folds the folder `src` into the folder `dst`: what is missing lands, folders on both sides fold the
// same way down, and a name on both sides takes the inner answer when the walk saw it unchanged.
// A move moves each landed entry and removes each source folder it emptied.
async function mergeInto(src, dst, rel, ctx, m) {
  ctx.job.check();
  for (const entry of await fsp.readdir(src)) {
    ctx.job.check();
    const from = join(src, entry), at = join(dst, entry), key = join(rel, entry),
      source = lstatOrNull(from);
    if (!source) continue;
    const there = lstatOrNull(at);
    let target = at,
      choice = "",
      trashed = null;
    if (there) {
      if (source.isDirectory() && there.isDirectory()) {
        await mergeInto(from, at, key, ctx, m);
        continue;
      }
      choice = m.innerHeld.get(key) === identity(there) ? m.inner : "refuse";
      if (choice === "skip") continue;
      if (choice === "keep") {
        target = freeCopyPath(dst, entry);
        if (!target) {
          refuseEntry(ctx, at, "every copy name for this item is already taken");
          continue;
        }
      } else if (choice === "replace") {
        const problem = replaceProblem(from, source, at, m.paths);
        if (problem) {
          refuseEntry(ctx, at, problem);
          continue;
        }
        try {
          trashed = trashOne(at);
        } catch {
          refuseEntry(ctx, at, "the item already there could not be moved to Trash, so nothing was replaced");
          continue;
        }
      } else {
        refuseEntry(ctx, at, "an item with that name is already there");
        continue;
      }
    }
    try {
      if (m.moving) await move(from, target, ctx);
      else await copyAny(from, target, ctx, true);
    } catch (e) {
      // Only the entry in flight is taken back on a cancel; what already landed stays.
      if ((e instanceof Cancelled || trashed) && !m.moving && ctx.made.has(target)) await fsp.rm(target, { recursive: true, force: true }).catch(() => {});
      const why = trashed ? putBack(trashed, at) : "";
      if (e instanceof Cancelled) throw why ? Object.assign(new Cancelled(), { sentence: stillInTrash("cancelled", why) }) : e;
      refuseEntry(ctx, target, why ? stillInTrash(e?.sentence ?? reason(e), why) : e?.sentence ?? reason(e));
      continue;
    }
    m.merged++;
    if (choice === "keep") m.keptBoth++;
  }
  if (m.moving) await fsp.rmdir(src).catch(() => {});
  if (ctx.durable) await fsyncPath(dst, ctx);
}

function treeSentence(ctx, verb) {
  const first = ctx.refused[0];
  if (ctx.refusedCount === 1) return `${first.name} could not be ${verb}: ${first.err}`;
  return `${ctx.refusedCount} items inside could not be ${verb}; the first is ${first.name}: ${first.err}`;
}

// ---- the transfer ----

let nextId = 1;
// One id space for transfers and archive jobs, so a transfercancel names exactly one of them.
export const nextJobId = () => nextId++;
const jobs = new Map(),
  // The tail of each destination drive's queue.
  queues = new Map();

export function transfer(request, send, listing, stamp) {
  // A Copy to dialog closes its menu before it submits the collision answer.
  // Keep the captured identities with that one-shot question, not with the UI's lifetime.
  const asked = question;
  question = null;
  const dest = request.dest, problem = destProblem(dest);
  const matches = asked && asked.id === request.collideId && typeof dest === "string"
    && asked.dest === resolve(dest) && asked.menuId === request.menuId;
  const selection = !request.menuId ? null
    : matches ? asked.selection : captureSelection(request.menuId);
  const named = request.menuId && selection
    ? { paths: selection.paths } : sources(request, listing, stamp, "transfer");
  if (named.stale) return send(named.stale);
  if (problem) return send({ t: "error", where: "transfer", path: String(dest ?? ""), msg: problem });
  const collide = request.collide;
  if (collide !== undefined && !WORDS.has(collide))
    return send({ t: "error", where: "transfer", path: dest, msg: `no collision answer is named ${collide}` });
  const inner = collide === "merge" ? request.inner ?? "refuse" : "refuse";
  if (!INNER.has(inner))
    return send({ t: "error", where: "transfer", path: dest, msg: `no collision answer inside a merge is named ${inner}` });
  const moving = request.op === "move",
    paths = named.paths,
    id = nextId++,
    job = new Job(id, send);
  const answered = collide !== undefined && matches ? asked.held : new Map();
  // Inner names are answered only by the merge walk this transfer names.
  const innerHeld = collide === "merge" && matches && asked.inner ? asked.inner : new Map();
  jobs.set(id, job);
  send({ t: "transferstarted", id, n: paths.length, moving });
  let drive;
  try {
    drive = String(statSync(dest, { bigint: true }).dev);
  } catch {
    drive = dest;
  }
  const run = () => runTransfer(job, { paths, dest, moving, collide, answered, selection, inner, innerHeld }).finally(() => jobs.delete(id));
  const tail = (queues.get(drive) ?? Promise.resolve()).then(run, run);
  queues.set(drive, tail);
  tail.finally(() => queues.get(drive) === tail && queues.delete(drive));
}

async function runTransfer(job, { paths, dest, moving, collide, answered, selection, inner, innerHeld }) {
  const send = job.send,
    fstype = (() => {
      try {
        return fsTypeOf(statSync(dest, { bigint: true }).dev);
      } catch {
        return "";
      }
    })(),
    durable = FAT.has(fstype);
  let ok = 0,
    failed = 0,
    skipped = 0,
    unconfirmed = false;
  const retryPaths = [],
    refused = [],
    touched = new Set([dest]),
    m = { moving, inner, innerHeld, paths, merged: 0, keptBoth: 0 },
    folded = [];
  for (let index = 0; index < paths.length; index++) {
    const src = paths[index],
      name = basename(src);
    if (job.cancelled) {
      skipped++;
      continue;
    }
    const fail = (err) => {
      failed++;
      retryPaths.push(src);
      send({ t: "transferitem", id: job.id, index, name, ok: false, err });
    };
    if (selection && !selectionItemUnchanged(selection, index)) {
      fail("Selected items changed; reopen the menu.");
      continue;
    }
    const source = isAbsolute(src) ? lstatOrNull(src) : null;
    if (!source) {
      fail(isAbsolute(src) ? "it no longer exists" : "the path is not absolute");
      continue;
    }
    let target = join(dest, name),
      trashed = null,
      merging = false,
      choice = "";
    if (sameFolder(src, dest)) {
      if (collide === undefined) {
        fail("already in that folder");
        continue;
      }
      if (moving) {
        skipped++;
        continue;
      }
      target = freeCopyPath(dest, name);
    } else {
      const there = lstatOrNull(target);
      if (there) {
        choice = answered.get(src) === identity(there) ? collide : "refuse";
        if (choice === "merge") {
          // A folder on a folder folds in; anything else on the first card takes the inner answer.
          if (source.isDirectory() && there.isDirectory()) merging = true;
          else choice = innerHeld.get(name) === identity(there) ? inner : "refuse";
        }
        if (merging) {
        } else if (choice === "skip") {
          skipped++;
          continue;
        } else if (choice === "keep") target = freeCopyPath(dest, name);
        else if (choice === "replace") {
          const problem = replaceProblem(src, source, target, paths);
          if (problem) {
            fail(problem);
            continue;
          }
          try {
            trashed = trashOne(target);
          } catch {
            fail("the item already there could not be moved to Trash, so nothing was replaced");
            continue;
          }
        } else {
          fail("an item with that name is already there");
          continue;
        }
      }
    }
    if (!target) {
      fail("every copy name for this item is already taken");
      continue;
    }
    if (source.isDirectory() && (resolve(target) + sep).startsWith(resolve(src) + sep)) {
      fail("a folder cannot be copied into itself");
      continue;
    }
    const ctx = { job, index, name, root: dest, made: new Set(), refused: [], refusedCount: 0, durable, fat: FAT.has(fstype), unconfirmed: false };
    const trashMetadata = moving && !merging ? trashRecord(src) : null;
    try {
      if (merging) {
        folded.push(name);
        await mergeInto(src, target, name, ctx, m);
      } else if (moving) await move(src, target, ctx);
      else await copyAny(src, target, ctx, true);
      if (!merging) {
        m.merged++;
        if (choice === "keep") m.keptBoth++;
      }
      if (moving) forgetTrashRecord(trashMetadata);
      if (ctx.durable) await fsyncPath(dirname(target), ctx);
      unconfirmed ||= ctx.unconfirmed;
      if (moving) touched.add(dirname(src));
      if (ctx.refusedCount) {
        refused.push(...ctx.refused.slice(0, REFUSED_CAP - refused.length));
        fail(treeSentence(ctx, moving ? "moved" : "copied"));
      } else {
        ok++;
        send({ t: "transferitem", id: job.id, index, name, ok: true });
      }
    } catch (e) {
      // A cancel removes what the item in flight wrote; any other failure leaves it, as upstream does for undo.
      // A merge never removes the folder it folds into: mergeInto took back its own entry in flight.
      if (e instanceof Cancelled && ctx.made.size && !merging) await fsp.rm(target, { recursive: true, force: true }).catch(() => {});
      // A failed copy that replaced an item takes back its partial copy, so the replaced item can return.
      if (trashed && !moving && ctx.made.has(target)) await fsp.rm(target, { recursive: true, force: true }).catch(() => {});
      const err = e?.sentence ?? reason(e),
        why = trashed ? putBack(trashed, target) : "";
      fail(why ? stillInTrash(err, why) : err);
    }
  }
  const done = { t: "transferdone", id: job.id, ok, failed, skipped, cancelled: job.cancelled, retryPaths, durable: durable && !unconfirmed && failed === 0, note: unconfirmed ? "copied, but the drive did not confirm the folder" : "" };
  // `into` names the merging folder only when it was the transfer's one item; anything beside it landed in dest.
  if (collide === "merge") Object.assign(done, { merged: m.merged, keptBoth: m.keptBoth, into: folded.length === 1 && paths.length === 1 ? folded[0] : basename(resolve(dest)) || resolve(dest) });
  if (refused.length) done.refused = refused;
  send(done);
  for (const path of touched) send({ t: "changed", path });
}

// One item and everything under it copied to `dst`, which must not exist yet: duplicate's copy.
// A tree entry the drive refused fails the whole copy with the transfer's own sentence.
export async function copyTree(src, dst) {
  const ctx = { job: new Job(0, () => {}), index: 0, name: basename(src), root: dirname(dst), made: new Set(),
    refused: [], refusedCount: 0, durable: false, fat: false, unconfirmed: false };
  await copyAny(src, dst, ctx, true);
  if (ctx.refusedCount) throw Object.assign(Error(treeSentence(ctx, "copied")), { sentence: treeSentence(ctx, "copied") });
}

export function transferCancel(request) {
  const job = jobs.get(request.id);
  if (job) job.cancelled = true;
}
