// Reading the Trash back: the sidebar's count (a `trashcount` line from the backend) and the Trash view's
// `trashbrowse` requests (list, window, select, summary, prepare, check, cancel, restore, delete).
// Upstream asks `gio`; flea-qml reads the same FreeDesktop.org Trash that src/trash.js writes:
// every `info/<name>.trashinfo` whose `files/<name>` is still there is one item.
//
// The Trash folders read are the home Trash, each mount's `.Trash/$uid` and `.Trash-$uid` when a
// mount table can be read, and every per-drive Trash flea has written into: the same on every system.
import { lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, unlinkSync, watch } from "node:fs";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { describeKind } from "./kinds.js";
import { homeTrash, knownTrashes, trashInfoOriginal, usableTrash } from "./trash.js";

import { reviewTrees } from "./menu.js";

const identity = (st) => `${st.dev}:${st.ino}:${st.mode & 0o170000}`;

// Every Trash folder that exists now: [{ trash, top }], top "" for the home Trash.
export function trashFolders() {
  const out = [],
    seen = new Set();
  const add = (trash, top) => {
    const key = resolve(trash);
    if (seen.has(key)) return;
    try {
      if (top && basename(dirname(trash)) === ".Trash") {
        const shared = lstatSync(dirname(trash));
        if (!shared.isDirectory() || !(shared.mode & 0o1000)) return;
      }
      for (const path of [trash, join(trash, "info"), join(trash, "files")]) {
        const st = lstatSync(path);
        if (!st.isDirectory() || (process.getuid && (st.uid !== process.getuid() || (st.mode & 0o077)))) return;
      }
    } catch {
      return;
    }
    seen.add(key);
    out.push({ trash: key, top });
  };
  add(homeTrash(), "");
  // Every system takes the same three sources: the home Trash, each mount's Trash when a mount
  // table can be read (Linux and Android have one; elsewhere the read fails and adds nothing), and
  // every per-drive Trash flea itself has written into.
  let mounts = "";
  try {
    mounts = readFileSync("/proc/self/mountinfo", "utf8");
  } catch {}
  const uid = process.getuid?.() ?? 0;
  for (const line of mounts.split("\n")) {
    // Field 5 is the mount point, with spaces and the like written as octal escapes.
    const top = line.split(" ")[4]?.replace(/\\([0-7]{3})/g, (_, o) => String.fromCharCode(parseInt(o, 8)));
    if (!top || !isAbsolute(top)) continue;
    add(join(top, ".Trash", String(uid)), top);
    add(join(top, `.Trash-${uid}`), top);
  }
  // A per-drive Trash's Path= is relative to the drive's top, the folder that holds the Trash.
  for (const trash of knownTrashes()) add(trash, basename(dirname(trash)) === ".Trash" ? dirname(dirname(trash)) : dirname(trash));
  return out;
}

// Every item now in the Trash, newest first.
export function readTrash() {
  const items = [];
  for (const { trash, top } of trashFolders()) {
    let names = [];
    try {
      names = readdirSync(join(trash, "info"));
    } catch {
      continue;
    }
    for (const entry of names) {
      if (!entry.endsWith(".trashinfo") || entry === ".trashinfo" || entry === "..trashinfo" || entry === "...trashinfo") continue;
      const name = entry.slice(0, -".trashinfo".length),
        file = join(trash, "files", name);
      let st, text;
      try {
        const metadata = lstatSync(join(trash, "info", entry));
        if (!metadata.isFile() || metadata.size > 1024 * 1024) continue;
        st = lstatSync(file);
        text = readFileSync(join(trash, "info", entry), "utf8");
      } catch {
        continue;
      }
      const original = trashInfoOriginal((/^Path=(.*)$/m.exec(text)?.[1] ?? "").trim(), top);
      const deleted = /^DeletionDate=(.*)$/m.exec(text)?.[1]?.trim() ?? "";
      const directory = st.isDirectory();
      items.push({
        uri: file,
        name,
        original,
        deleted,
        directory,
        icon: describeKind(original.split(/[\\/]/).pop() || name, directory, st.mode, undefined).icon,
        identity: `${identity(st)}:${JSON.stringify(text)}`,
        fileIdentity: identity(st),
        file,
        info: join(trash, "info", entry),
      });
    }
  }
  return items.sort((a, b) => (a.deleted < b.deleted ? 1 : a.deleted > b.deleted ? -1 : 0));
}

// ---- the Trash count the backend reports: once at start, then on every change ----

// Calls onCount with the item count now and whenever a Trash folder changes. Runs inside the
// backend, so it lives exactly as long as the interface and adds no process of its own.
export function watchTrashCount(onCount) {
  let last = "",
    timer = null;
  const report = () => {
    timer = null;
    const items = readTrash();
    const signature = JSON.stringify(items.map(item => [item.uri, item.identity]));
    if (signature !== last) {
      last = signature;
      onCount(items.length);
    }
  };
  const watched = new Map();
  const schedule = () => {
    timer ??= setTimeout(report, 120);
    timer.unref?.();
  };
  const arm = () => {
    const dirs = new Set(trashFolders().flatMap(({trash}) => [join(trash, "files"), join(trash, "info")]));
    for (const [dir, watcher] of watched) {
      if (!dirs.has(dir)) { watcher.close(); watched.delete(dir); }
    }
    for (const { trash } of trashFolders())
      for (const sub of ["files", "info"]) {
        const dir = join(trash, sub);
        if (watched.has(dir)) continue;
        try {
          const watcher = watch(dir, { persistent: false }, schedule);
          watcher.on("error", () => { watcher.close(); watched.delete(dir); schedule(); });
          watched.set(dir, watcher);
        } catch {}
      }
  };
  // The home Trash is made first, as the specification allows, so there is a folder to watch
  // before anything has ever been trashed.
  try {
    usableTrash(homeTrash());
  } catch {}
  arm();
  report();
  // A drive mounted later, with a Trash of its own, is picked up within a few seconds.
  const interval = setInterval(() => {
    arm();
    schedule();
  }, 5000);
  interval.unref?.();
  return () => { clearInterval(interval); clearTimeout(timer); for (const watcher of watched.values()) watcher.close(); watched.clear(); };
}

// ---- the Trash view ----

let snapshot = [],
  selection = null,
  selectionTokens = 0,
  review = null,
  reviewTokens = 0;

const rowOf = (item) => ({
  uri: item.uri,
  name: item.name,
  original: item.original,
  deleted: item.deleted,
  directory: item.directory,
  icon: item.icon,
  identity: item.identity,
  ...(selection?.has(item.uri) ? { bulkSelected: true } : {}),
});

// The items a restore or delete names: all of them, the bulk selection minus exclusions, or URIs,
// each still holding the identity the client saw.
function chosen(request, items) {
  const byUri = new Map(items.map((item) => [item.uri, item]));
  if (request.all) return { items };
  const exclude = new Set(request.exclude ?? []);
  let picked = [];
  if (request.selectionToken) {
    if (!selection || selection.token !== request.selectionToken) return { stale: true };
    picked = [...selection.keys()].filter((uri) => !exclude.has(uri)).map((uri) => {
      const item = byUri.get(uri);
      return item?.identity === selection.get(uri) ? item : null;
    });
  } else {
    picked = (request.uris ?? []).map((uri, i) => {
      const item = byUri.get(uri);
      const want = request.identities?.[i];
      return item && (!want || want === item.identity) ? item : null;
    });
  }
  if (picked.some((item) => !item)) return { stale: true };
  return { items: picked };
}

function removeItem(item) {
  rmSync(item.file, { recursive: true, force: false });
  try {
    unlinkSync(item.info);
  } catch {}
}

function restoreItem(item) {
  if (!item.original || !isAbsolute(item.original)) throw new Error("the Trash does not say where it came from");
  try {
    lstatSync(item.original);
    throw Object.assign(new Error("an item with that name is already there"), { taken: true });
  } catch (e) {
    if (e.taken || e.code !== "ENOENT") throw e;
  }
  mkdirSync(dirname(item.original), { recursive: true });
  renameSync(item.file, item.original);
  try {
    unlinkSync(item.info);
  } catch {}
}

const reason = (e) =>
  ({ EACCES: "permission denied", EPERM: "permission denied", EXDEV: "it would have to cross drives", EROFS: "the drive is read-only" })[e?.code] ??
  String(e?.message ?? e);

export function trashbrowse(request, send) {
  try { return handleTrashBrowse(request, send); }
  catch (error) { send({t: "trashbrowse", op: request.op ?? "", id: request.id ?? 0, ok: false, error: reason(error)}); }
}

function validReview() {
  if (!review) return false;
  const now = new Map(readTrash().map(item => [item.uri, item.identity]));
  if (!review.items.every(item => now.get(item.uri) === item.identity)) return false;
  try { return JSON.stringify(reviewTrees(review.items.map(item => item.file)).rows) === JSON.stringify(review.tree.rows); }
  catch { return false; }
}

function handleTrashBrowse(request, send) {
  const id = request.id ?? 0,
    op = request.op ?? "",
    answer = (fields) => send({ t: "trashbrowse", op, id, ok: true, ...fields });
  const windowOf = (start, count) => {
    const from = Math.max(0, Math.min(start | 0, snapshot.length));
    return snapshot.slice(from, from + Math.max(0, count | 0)).map(rowOf);
  };
  const selectionFields = () => (selection ? { selectionToken: selection.token, selectionCount: selection.size, selectionStale: false } : {});
  if (op === "list") {
    snapshot = readTrash();
    if (selection) for (const uri of [...selection.keys()]) if (!snapshot.some((item) => item.uri === uri)) selection.delete(uri);
    const present = new Set(snapshot.map((item) => item.uri));
    return answer({
      total: snapshot.length,
      start: request.start ?? 0,
      rows: windowOf(request.start ?? 0, request.count ?? 0),
      present: (request.uris ?? []).filter((uri) => present.has(uri)),
      recoveredCount: 0,
      recoveryErrors: [],
      ...selectionFields(),
    });
  }
  if (op === "window") return answer({ total: snapshot.length, start: request.start ?? 0, rows: windowOf(request.start ?? 0, request.count ?? 0), ...selectionFields() });
  if (op === "select") {
    selection = new Map(snapshot.map((item) => [item.uri, item.identity]));
    selection.token = ++selectionTokens;
    return answer({ selectionToken: selection.token, selectionCount: selection.size });
  }
  if (op === "cancel") {
    review = null;
    if (request.clearSelection) selection = null;
    return answer({});
  }
  if (op === "summary") return answer({ bytes: reviewTrees(snapshot.map(item => item.file)).bytes, partial: false });
  if (op === "prepare") {
    review = null;
    const picked = chosen(request, readTrash());
    if (picked.stale) return send({ t: "trashbrowse", op, id, ok: false, stale: true, error: "The Trash changed; review it again." });
    const tree = reviewTrees(picked.items.map(item => item.file));
    review = { token: ++reviewTokens, items: picked.items.map((item) => ({ ...item })), tree };
    return answer({
      token: review.token,
      all: request.emptyTrash === true || request.all === true,
      count: review.items.length,
      bytes: tree.bytes,
      partial: false,
    });
  }
  if (op === "check") {
    const valid = !!review && review.token === request.token && validReview();
    return answer({ valid });
  }
  if (op === "delete" || op === "restore") {
    let items;
    if (op === "delete") {
      // Only the reviewed snapshot deletes, once.
      if (!review || review.token !== request.token || !validReview()) return send({ t: "trashbrowse", op, id, ok: false, stale: true, error: "The Trash changed; review it again." });
      items = review.items;
      review = null;
    } else {
      const picked = chosen(request, readTrash());
      if (picked.stale) return send({ t: "trashbrowse", op, id, ok: false, stale: true, error: "The Trash changed; select the items again." });
      items = picked.items;
    }
    let done = 0;
    const failures = [],
      folders = new Set();
    for (const item of items) {
      try {
        // Checked again just before acting, so an item swapped since it was seen is left alone.
        if (identity(lstatSync(item.file)) !== item.fileIdentity) throw new Error("it changed in the Trash");
        if (op === "delete") removeItem(item);
        else {
          restoreItem(item);
          folders.add(dirname(item.original));
        }
        done++;
      } catch (e) {
        failures.push({ uri: item.uri, name: item.original.split(/[\\/]/).pop() || item.name, error: reason(e), identity: item.identity });
      }
    }
    selection = null;
    answer({ done, failed: failures.length, failures });
    for (const path of folders) send({ t: "changed", path });
    return;
  }
  send({ t: "trashbrowse", op, id, ok: false, error: `${op || "That Trash action"} is not ported to flea-qml yet.` });
}
