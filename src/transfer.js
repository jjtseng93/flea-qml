// Copying and moving files: the `collisions` question, `transfer` and `transfercancel`
// (docs/protocol.md). Upstream: src/backend/transfer*.rs and ops.rs.
//
// Ported: copy and move of files, folders and symlinks, each target created exclusively; a
// cross-drive move copies and then removes the source; per-drive queueing; progress; cancel,
// which removes what the item in flight had written; the collide words keep, skip and refuse;
// fsync onto FAT-family drives. Not yet: undo's journal, `replace` (it needs the Trash),
// `merge` (the question answers mergeable:false, so the card never offers it), `fatnames`, and
// fifos, sockets and device nodes, which are refused rather than opened.
import { constants, promises as fsp, lstatSync, statSync, accessSync } from "node:fs";
import { basename, dirname, join, relative, resolve, isAbsolute, sep } from "node:path";
import { fsTypeOf } from "./fsinfo.js";
import { describeKind } from "./kinds.js";
import { capturedPaths, captureSelection, selectionItemUnchanged } from "./menu.js";

const WORDS = new Set(["keep", "replace", "skip", "refuse", "merge"]);
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
  if (request.menuId !== undefined && command !== "paths") {
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
      if (row) paths.push(join(listing.path || ".", row.name));
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
  if (named.stale) return send(request.menuId === undefined ? named.stale : { t: "collisions", id: request.id ?? 0, total: 0, names: [], mergeable: false });
  const id = request.id ?? 0,
    dest = request.dest,
    held = new Map(),
    names = [];
  let total = 0;
  if (!destProblem(dest)) {
    for (const path of named.paths) {
      if (!isAbsolute(path) || sameFolder(path, dest)) continue;
      const source = lstatOrNull(path);
      if (!source) continue;
      const there = lstatOrNull(join(dest, basename(path)));
      if (!there) continue;
      total++;
      held.set(path, identity(there));
      if (names.length < 3) {
        const name = basename(path),
          dir = source.isDirectory();
        names.push({ n: name, d: dir, i: describeKind(name, dir, source.mode, undefined).icon });
      }
    }
  }
  question = { id, dest: typeof dest === "string" ? resolve(dest) : "", held,
    menuId: request.menuId, selection: request.menuId === undefined ? null : captureSelection(request.menuId) };
  send({ t: "collisions", id, total, names, mergeable: false });
}

// ---- copying ----

const reason = (e) =>
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
    let type;
    if (process.platform === "win32") type = lstatOrNull(resolve(dirname(src), text))?.isDirectory() ? "dir" : "file";
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
  if (ctx.refusedCount) return;
  await fsp.rm(src, { recursive: true, force: false });
}

function treeSentence(ctx, verb) {
  const first = ctx.refused[0];
  if (ctx.refusedCount === 1) return `${first.name} could not be ${verb}: ${first.err}`;
  return `${ctx.refusedCount} items inside could not be ${verb}; the first is ${first.name}: ${first.err}`;
}

// ---- the transfer ----

let nextId = 1;
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
  const selection = request.menuId === undefined ? null
    : matches ? asked.selection : captureSelection(request.menuId);
  const named = request.menuId !== undefined && selection
    ? { paths: selection.paths } : sources(request, listing, stamp, "transfer");
  if (named.stale) return send(named.stale);
  if (problem) return send({ t: "error", where: "transfer", path: String(dest ?? ""), msg: problem });
  const collide = request.collide;
  if (collide !== undefined && !WORDS.has(collide))
    return send({ t: "error", where: "transfer", path: dest, msg: `no collision answer is named ${collide}` });
  const moving = request.op === "move",
    paths = named.paths,
    id = nextId++,
    job = new Job(id, send);
  const answered = collide !== undefined && matches ? asked.held : new Map();
  jobs.set(id, job);
  send({ t: "transferstarted", id, n: paths.length, moving });
  let drive;
  try {
    drive = String(statSync(dest, { bigint: true }).dev);
  } catch {
    drive = dest;
  }
  const run = () => runTransfer(job, { paths, dest, moving, collide, answered, selection }).finally(() => jobs.delete(id));
  const tail = (queues.get(drive) ?? Promise.resolve()).then(run, run);
  queues.set(drive, tail);
  tail.finally(() => queues.get(drive) === tail && queues.delete(drive));
}

async function runTransfer(job, { paths, dest, moving, collide, answered, selection }) {
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
    touched = new Set([dest]);
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
    let target = join(dest, name);
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
        const choice = answered.get(src) === identity(there) ? collide : "refuse";
        if (choice === "skip") {
          skipped++;
          continue;
        }
        if (choice === "keep") target = freeCopyPath(dest, name);
        else if (choice === "replace") {
          fail("replacing through the Trash is not ported yet, so nothing was replaced");
          continue;
        } else if (choice === "merge") {
          fail("merging folders is not ported yet, so nothing was merged");
          continue;
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
    try {
      if (moving) await move(src, target, ctx);
      else await copyAny(src, target, ctx, true);
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
      if (e instanceof Cancelled && ctx.made.size) await fsp.rm(target, { recursive: true, force: true }).catch(() => {});
      fail(e?.sentence ?? reason(e));
    }
  }
  const done = { t: "transferdone", id: job.id, ok, failed, skipped, cancelled: job.cancelled, retryPaths, durable: durable && !unconfirmed && failed === 0, note: unconfirmed ? "copied, but the drive did not confirm the folder" : "" };
  if (refused.length) done.refused = refused;
  send(done);
  for (const path of touched) send({ t: "changed", path });
}

export function transferCancel(request) {
  const job = jobs.get(request.id);
  if (job) job.cancelled = true;
}
