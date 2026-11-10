// flea-qml's backend: the requests ui/Backend.qml writes to `flea --backend`, one JSON object per
// line on stdin, answered one per line on stdout (docs/protocol.md). Upstream: src/backend/run.rs.
// So far: list, window, sort, fsinfo, peek, meta, code, the four clip requests,
// paths, menuaction (snapshot, activate, validate, close), collisions, transfer, transfercancel and quit, and `changed` lines for watched folders. Any other request is noted on stderr and
// left unanswered, which ui/ already survives for an operation that never reports back.
import { createInterface } from "node:readline";
import { fsinfo } from "./fsinfo.js";
import { code } from "./code.js";
import { clipClear, clipGet, clipSet, clipWatch } from "./clip.js";
import { clipHostReply } from "./clip-host.js";
import { collisions, sources, transfer, transferCancel } from "./transfer.js";
import { menuaction } from "./menu.js";
import { trash } from "./trash.js";
import { trashbrowse, watchTrashCount } from "./trashbrowse.js";
import { findCommand } from "./find.js";
import { listDone, listFailed, onChanged, watchColumn, watchList } from "./watch.js";
import { meta } from "./meta.js";
import { peek } from "./peek.js";
import { Listing, directoryFacts } from "./listing.js";
import { SORT_KEYS } from "./order.js";
import { lstatSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

// FLEA_BACKEND_LOG=/some/file appends every request and answer there, for debugging.
const trace = process.env.FLEA_BACKEND_LOG ? (await import("node:fs")).appendFileSync.bind(null, process.env.FLEA_BACKEND_LOG) : null;
const send = (object) => {
  const line = `${JSON.stringify(object)}\n`;
  trace?.(`< ${line}`);
  process.stdout.write(line);
};
const error = (where, path, msg, extra = {}) => send({ t: "error", where, path, msg, ...extra });

let listing = null,
  // The numbering a row index is read in; the first listing is 1 (docs/protocol.md "listing").
  stamp = 0,
  order = { by: "name", desc: false, foldersFirst: true, groupByKind: false, hiddenLast: false };

const orderFrom = (request, previous) => ({
  by: request.by ?? previous.by,
  desc: request.desc ?? previous.desc,
  foldersFirst: request.foldersFirst ?? previous.foldersFirst,
  groupByKind: request.groupByKind ?? previous.groupByKind,
  hiddenLast: request.hiddenLast ?? previous.hiddenLast,
});
const listed = (read, sorted, extra = {}) =>
  send({ t: "listed", n: listing.rows.length, read, sort: sorted, ...directoryFacts(listing.path), path: listing.path, ...extra });
const rows = (start, count, extra = {}) => send({ t: "rows", ...listing.window(start, count), listing: stamp, ...extra });
// A request's `gen` rides back on its listed and rows lines, so a Find answer lands on its own query.
const genOf = (request) => (Number.isSafeInteger(request.gen) && request.gen > 0 ? { gen: request.gen } : {});

function list(request) {
  const path = request.path ?? "",
    first = request.first ?? 0;
  // A list with no ordering fields is name ascending, folders first, without kind groups.
  const next = orderFrom(request, { by: "name", desc: false, foldersFirst: true, groupByKind: false, hiddenLast: false });
  if (!SORT_KEYS.has(next.by)) return error("sort", next.by, `no order is named ${next.by}`);
  let fresh;
  const started = performance.now(),
    armed = watchList(path);
  try {
    fresh = Listing.scan(path, request.hidden === true);
  } catch (e) {
    listFailed(armed);
    // A failed list leaves the previous listing in place; `mode` only when the path could be stat'd.
    let mode;
    try {
      mode = lstatSync(path || ".").mode;
    } catch {}
    return error("scan", path, e.code === "EACCES" ? "permission denied" : e.message, mode === undefined ? {} : { mode });
  }
  const scanned = performance.now() - started;
  const [read, sorted] = fresh.sort(next);
  let changed;
  if (request.wantChanged && listing && resolve(listing.path || ".") === resolve(path || ".")) {
    const before = new Set(listing.rows.map((row) => row.name)),
      after = new Set(fresh.rows.map((row) => row.name));
    changed = 0;
    for (const name of before) if (!after.has(name)) changed++;
    for (const name of after) if (!before.has(name)) changed++;
  }
  listDone(armed);
  listing = fresh;
  order = next;
  stamp++;
  listed(scanned + read, sorted, { ...(changed === undefined ? {} : { changed }), ...genOf(request) });
  // `select` moves the first window onto its row when that row lies past `first`.
  let start = 0;
  if (typeof request.select === "string" && resolve(dirname(request.select)) === resolve(path || ".")) {
    const index = listing.indexOfName(basename(request.select));
    if (index >= first) start = Math.max(0, Math.min(index - Math.floor(first / 2), listing.rows.length - first));
  }
  rows(start, first, genOf(request));
  // flea-qml: an emptied Find query lands back on the folder, and its terminal line follows the rows.
  if (request.searched && typeof request.searched === "object")
    send({ ...request.searched, t: "searched", n: listing.rows.length, ...genOf(request) });
}

// A listing of the paths the client names, in that order (docs/protocol.md "listpaths"). flea-qml
// adds `base`, for Find: the paths are relative to it, as a `find .` run there prints them, and the
// listing's own base is that folder. `append` adds to the listing the same base and gen built, so a
// stream of results costs one lstat per new path; `searched` closes a Find answer with its terminal
// line, sent after these rows so the two arrive in order.
function listpaths(request) {
  const started = performance.now(),
    base = typeof request.base === "string" && request.base ? request.base : "/",
    first = request.first ?? 0,
    gen = genOf(request);
  const fresh = [];
  for (const path of Array.isArray(request.paths) ? request.paths : []) {
    if (typeof path !== "string" || !path) continue;
    let name;
    if (request.base) name = path.replace(/^\.\//, "");
    else if (path.startsWith("/") && path !== "/") name = path.slice(1);
    if (!name || name === "." || name.split("/").includes("..")) continue;
    let st;
    try {
      st = lstatSync(join(base, name));
    } catch {
      continue;
    }
    fresh.push({ name, dir: st.isDirectory(), link: st.isSymbolicLink() });
  }
  const appending = request.append === true && listing?.fromPaths && listing.path === base && listing.gen === request.gen;
  if (appending) listing.rows.push(...fresh);
  else {
    listing = new Listing(base, fresh);
    listing.fromPaths = true;
    listing.gen = request.gen;
    stamp++;
  }
  listed(performance.now() - started, 0, gen);
  rows(0, first, gen);
  if (request.searched && typeof request.searched === "object")
    send({ ...request.searched, t: "searched", n: listing.rows.length, ...gen });
}

function sort(request) {
  const next = orderFrom(request, order);
  if (!SORT_KEYS.has(next.by)) return error("sort", String(request.by), `no order is named ${request.by}`);
  if (!listing) return;
  const [read, sorted] = listing.sort(next);
  order = next;
  stamp++;
  listed(read, sorted);
}

// The `code` job running for each slot.
const codeJobs = new Map();

const handlers = {
  list,
  sort,
  listpaths,
  window: (request) => listing && rows(request.start ?? 0, request.count ?? 0),
  fsinfo: () => listing && send(fsinfo(listing.path)),
  peek: (request) => {
    if (request.watch === true && typeof request.path === "string") watchColumn(request.path, request.keep);
    send(peek(request));
  },
  // Answered when ready, off the read loop; a newer request on the same slot ends the older job,
  // whose reply is never sent.
  code: (request) => {
    const slot = request.slot ?? "";
    codeJobs.get(slot)?.abort();
    const job = new AbortController();
    codeJobs.set(slot, job);
    code(request, job.signal).then((line) => {
      if (codeJobs.get(slot) !== job) return;
      codeJobs.delete(slot);
      if (line) send(line);
    });
  },
  // A row the listing no longer holds is dropped in silence; the client asks again after its rows.
  // A compressed tar's listing streams, so the line is sent when it is ready.
  meta: (request) => {
    meta(listing, request).then((line) => line && send(line)).catch((err) => send({ t: "error", where: "meta", msg: String(err?.message ?? err) }));
  },
  // Answered off the read loop: a slow clipboard owner holds up no other request.
  clipSet: (request) => clipSet(request, send),
  clipGet: (request) => clipGet(request, send),
  clipClear: (request) => clipClear(request, send),
  clipWatch: (request) => clipWatch(request, send),
  clipHostReply,
  // Rows read as paths, the way copy, cut and drag name a selection wider than the client's window.
  paths: (request) => {
    const named = sources(request, listing, stamp, "paths");
    send(named.stale ?? { t: "paths", paths: named.paths });
  },
  menuaction: (request) => menuaction(request, send, listing, stamp),
  trashbrowse: (request) => trashbrowse(request, send),
  trash: (request) => {
    const named = sources(request, listing, stamp, "trash");
    if (named.stale) return send(named.stale);
    trash(request, send, named);
  },
  collisions: (request) => collisions(request, send, listing, stamp),
  transfer: (request) => transfer(request, send, listing, stamp),
  transfercancel: (request) => transferCancel(request),
  quit: () => process.exit(0),
};

export function runBackend() {
  onChanged(send);
  // The command the interface runs for Find, which it spawns and reads itself; null when none exists.
  send({ t: "findcommand", argv: findCommand() });
  // The sidebar's Trash count, sent when it changes; upstream's UI ran `gio monitor` for it.
  let trashRevision = 0;
  watchTrashCount((count) => send({ t: "trashcount", count, revision: ++trashRevision }));
  const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
  lines.on("line", (line) => {
    if (!line.trim()) return;
    trace?.(`> ${line}\n`);
    let request;
    try {
      request = JSON.parse(line);
    } catch {
      return error("read", "", "a request line is not JSON");
    }
    const handler = handlers[request.c];
    if (handler) handler(request);
    else console.error(`flea-qml backend: not implemented yet: ${request.c}`);
  });
  // Stdin closing ends the backend as quit does, with exit code 0 either way.
  lines.on("close", () => process.exit(0));
}
