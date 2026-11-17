// flea-qml's backend: the requests ui/Backend.qml writes to `flea --backend`, one JSON object per
// line on stdin, answered one per line on stdout (docs/protocol.md). Upstream: src/backend/run.rs.
// So far: list, window, sort, fsinfo, peek, meta, code, the four clip requests,
// paths, menuaction (snapshot, activate, validate, close), collisions, mergecollisions, transfer, transfercancel, places and quit,
// mkdir, newfile, duplicate, bulkrename, permissions, permissionsBatch, formats and archive, and `changed` lines for watched folders. Any other request is noted on stderr and
// left unanswered, which ui/ already survives for an operation that never reports back.
import { createInterface } from "node:readline";
import { fsinfo } from "./fsinfo.js";
import { code } from "./code.js";
import { compare } from "./compare.js";
import { html } from "./html.js";
import { renderDiagram } from "./figure.js";
import { clipClear, clipGet, clipSet, clipWatch } from "./clip.js";
import { clipHostReply } from "./clip-host.js";
import { dirsize, dirsizeCancel, dirsizeInit, forgetSizes } from "./dirsize.js";
import { collisions, mergeCollisions, sources, transfer, transferCancel } from "./transfer.js";
import { menuaction, capturedPaths } from "./menu.js";
import {renameWithTrashRecord} from './trash-record.js';
import { trash } from "./trash.js";
import { duplicate, mkdir, newfile } from "./create.js";
import { bulkrename } from "./bulkrename.js";
import { permissions, permissionsBatch } from "./permissions.js";
import { archive, archiveCancel, formats } from "./archiveops.js";
import { trashbrowse, readTrash, watchTrashCount } from "./trashbrowse.js";
import { findCommand, grepCommand } from "./find.js";
import { places } from "./places.js";
import { listDone, listFailed, onChanged, watchColumn, watchList } from "./watch.js";
import { meta } from "./meta.js";
import { peek } from "./peek.js";
import { Listing, directoryFacts } from "./listing.js";
import { SORT_KEYS } from "./order.js";
import { lstatSync } from "node:fs";
import { basename, dirname, join, resolve, isAbsolute } from "node:path";

// Listing and state startup do not need the Markdown/Temml preview engine.
const markdownHtml = request => import("./markdown-html.js").then(module => module.markdownHtml(request));

// FLEA_BACKEND_LOG=/some/file appends every request and answer there, for debugging.
const trace = process.env.FLEA_BACKEND_LOG ? (await import("node:fs")).appendFileSync.bind(null, process.env.FLEA_BACKEND_LOG) : null;
const send = (object) => {
  // A changed folder's size, and every size above it, is no longer known (src/dirsize.js).
  if (object.t === "changed") forgetSizes(object.path);
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

// The longest matched text a row keeps; the client already cuts it, this bounds what it may send.
export const MATCH_TEXT_LIMIT = 400;
/** A content search's match for one row, checked and bounded, or null. */
export function matchOf(value) {
  if (!value || typeof value !== "object") return null;
  const l = Number(value.l);
  if (!Number.isInteger(l) || l < 1 || typeof value.t !== "string") return null;
  return { l, t: value.t.slice(0, MATCH_TEXT_LIMIT) };
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
  // A content search sends, beside each path, the line it matched: {l: line number, t: text}.
  const matches = Array.isArray(request.matches) ? request.matches : [];
  const paths = Array.isArray(request.paths) ? request.paths : [];
  for (let at = 0; at < paths.length; at++) {
    const path = paths[at];
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
    const row = { name, dir: st.isDirectory(), link: st.isSymbolicLink() };
    const match = matchOf(matches[at]);
    if (match) row.match = match;
    fresh.push(row);
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

// Trash is a collection of real paths, presented through the ordinary listing.
// Relative names retain each mount's identity; display metadata never becomes an IO path.
function listtrash(request) {
  const started = performance.now();
  const items = readTrash();
  listing = new Listing("/", items.map(item => ({
    name: process.platform === "win32" ? item.file.replaceAll("\\", "/") : item.file.slice(1), dir: item.directory, trash: item,
  })));
  listing.fromPaths = true;
  listing.trash = true;
  stamp++;
  listed(performance.now() - started, 0);
  rows(0, request.first ?? 100);
}
function trashRequest(request) {
  if (request.menuId) {
    const paths = capturedPaths(request.menuId);
    const picked = paths?.map(path => listing?.trash ? listing.rows.find(row => row.trash && resolve(row.trash.file) === resolve(path))?.trash : null);
    if (!picked?.length || picked.some(item => !item))
      return send({t:"trashbrowse",op:request.op,id:request.id,ok:false,stale:true,error:"Selected items changed; reopen the menu."});
    request = {...request, rows:undefined, all:false, uris:picked.map(item=>item.uri), identities:picked.map(item=>item.identity)};
  }
  if (Array.isArray(request.rows)) {
    if (!listing?.trash || request.listing !== stamp)
      return send({t:"trashbrowse",op:request.op,id:request.id,ok:false,stale:true,error:"The listing changed; select the Trash items again."});
    const picked = [...new Set(request.rows)].map(i => Number.isInteger(i) ? listing.rows[i]?.trash : null);
    if (!picked.length || picked.some(item => !item))
      return send({t:"trashbrowse",op:request.op,id:request.id,ok:false,error:"No Trash items selected."});
    request = {...request,uris:picked.map(item=>item.uri),identities:picked.map(item=>item.identity)};
  }
  trashbrowse(request, send);
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

const htmlJobs = new Map();
const markdownJobs = new Map();
let compareJob;
const handlers = {
  compare: request => {
    compareJob?.abort();
    const job = compareJob = new AbortController();
    compare(request, {signal:job.signal}).then(reply => {
      if(compareJob !== job)return;
      compareJob = null;
      if(reply)send(reply);
    }).catch(() => {
      if(compareJob !== job)return;
      compareJob = null;
      send({t:'compare',token:request.token,state:'failed',patch:''});
    });
  },
  html: request => {
    const slot = request.slot ?? "";
    const job = {};
    htmlJobs.set(slot, job);
    html(request).then(reply => {
      if (htmlJobs.get(slot) !== job) return;
      htmlJobs.delete(slot);
      if (reply) send(reply);
    }).catch(() => {
      if (htmlJobs.get(slot) !== job) return;
      htmlJobs.delete(slot);
      send({t:"html",slot,token:request.token,state:"failed",html:"",total:0});
    });
  },
  // One Mermaid diagram for the block view's figures (ui/FigureService.qml), drawn by src/figure.js;
  // the answer names the request's id and carries either the SVG or the reason there is none.
  figure: request => {
    renderDiagram(request.source, request.theme ?? {}).then(answer =>
      send({ t: "figure", id: request.id, svg: answer.svg ?? "", error: answer.svg === undefined ? answer.error ?? "render failed" : "" }));
  },
  // A Markdown file as one passive page for a sandboxed web view (src/markdown-html.js);
  // a newer request on the same slot drops the older one's reply.
  markdownhtml: request => {
    const slot = request.slot ?? "";
    const job = {};
    markdownJobs.set(slot, job);
    markdownHtml(request).then(reply => {
      if (markdownJobs.get(slot) !== job) return;
      markdownJobs.delete(slot);
      send(reply);
    }).catch(() => {
      if (markdownJobs.get(slot) !== job) return;
      markdownJobs.delete(slot);
      send({t:"markdownhtml",slot,token:request.token,state:"failed",html:""});
    });
  },
  list,
  sort,
  listpaths,
  listtrash,
  rename: request => {
    try {
      const source=request.path,name=request.to;
      if(typeof source!=="string" || !isAbsolute(source) || typeof name!=="string" || !name || name==='.' || name==='..' || /[\\/\0]/.test(name))throw Error('Invalid file name');
      if(request.menuId && !capturedPaths(request.menuId)?.some(path=>resolve(path)===resolve(source)))throw Error('Selected item changed; reopen Rename');
      const target=join(dirname(source),name);
      if(resolve(target)!==resolve(source))renameWithTrashRecord(source,target);
      send({t:'renamed',ok:true,path:process.platform==='win32'?target.replaceAll('\\','/'):target});send({t:'changed',path:process.platform==='win32'?dirname(source).replaceAll('\\','/'):dirname(source)});
    }catch(e){send({t:'renamed',ok:false,path:request.path});error('rename',request.path,e.message)}
  },
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
  trashbrowse: trashRequest,
  trash: (request) => {
    const named = sources(request, listing, stamp, "trash");
    if (named.stale) return send(named.stale);
    trash(request, send, named);
  },
  collisions: (request) => collisions(request, send, listing, stamp),
  mergecollisions: (request) => mergeCollisions(request, send, listing, stamp),
  dirsize,
  dirsizecancel: dirsizeCancel,
  transfer: (request) => transfer(request, send, listing, stamp),
  // One id space for both: an archive job's id is never a transfer's.
  transfercancel: (request) => archiveCancel(request.id) || transferCancel(request),
  mkdir: (request) => mkdir(request, send),
  newfile: (request) => newfile(request, send),
  duplicate: (request) => duplicate(request, send),
  bulkrename: (request) => bulkrename(request, send),
  permissions: (request) => permissions(request, send),
  permissionsBatch: (request) => permissionsBatch(request, send),
  formats: (request) => formats(request, send),
  archive: (request) => archive(request, send),
  // The sidebar's folders and drives, found by looking; `watch` keeps looking while a rail shows.
  places: (request) => places(request, send),
  quit: () => process.exit(0),
};

export function runBackend() {
  onChanged(send);
  dirsizeInit(send, () => listing);
  // The command the interface runs for Find, which it spawns and reads itself; null when none exists.
  send({ t: "findcommand", argv: findCommand(), grep: grepCommand() });
  // The sidebar's Trash count, sent when it changes; upstream's UI ran `gio monitor` for it.
  let trashRevision = 0;
  watchTrashCount((count) => send({ t: "trashcount", count, revision: ++trashRevision }));
  // The sidebar's probed places, named once at start; a rail asks for them again while it shows.
  places({}, send);
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
