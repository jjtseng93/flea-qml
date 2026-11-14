// Folder sizes, only when the user asks (docs/protocol.md "dirsize"): a click on a folder's ⚖️ Size
// cell asks for that row, the ⚖️ on the Size header asks for every folder in the listing. Nothing
// here ever starts a walk on its own: no viewport sweep, no size sort, no refresh.
//
// The walk is `du -s -b -x -0`, streamed: bunmsh's du beside this repository or on PATH, else the
// system's (src/find.js duCommand). -b is apparent bytes, the unit file rows already show; -x stays
// on the folder's own filesystem as upstream's walker does; each folder's line arrives as soon as
// it is finished, so sizes land one by one. One du runs at a time; rows asked while it runs wait
// for the next one. Several folders share one run, so a file hard-linked into two of them counts
// in the first only, as `du -s a b` counts it.
//
// Answers are kept by full path and handed out again on later rows (`z`, and `zp` when partial)
// after a sort, a refresh or a return to the folder, never recomputed. A `changed` line for a
// folder forgets that folder and every folder above it, whose totals it is part of, and nothing
// else: a busy folder never touches the sizes of its siblings. A change deep inside a measured
// folder that no watch sees leaves its size as it was until the user measures it again.
import { resolve, dirname } from "node:path";
import { duCommand } from "./find.js";

const known = new Map(),
  waiting = new Set();
let job = null,
  send = () => {},
  current = () => null;

export function dirsizeInit(sender, listingOf) {
  send = sender;
  current = listingOf;
}

/** The kept size of the folder at `path`, or undefined. */
export const keptSize = (path) => known.get(resolve(path));

/** A folder changed: its own size and every one above it are no longer known. */
export function forgetSizes(path) {
  if (!known.size || typeof path !== "string") return;
  let at = resolve(path);
  for (;;) {
    known.delete(at);
    const up = dirname(at);
    if (up === at) break;
    at = up;
  }
}

// The row a measured path holds in the listing now, which a sort since the ask may have moved.
function rowOf(full) {
  const listing = current();
  if (!listing || listing.trash) return -1;
  const base = resolve(listing.path || ".");
  return listing.rows.findIndex((row) => row.dir && resolve(base, row.name) === full);
}

/** `dirsize`: { rows: [...] } or { all: true }; answers dirsized per folder, then one dirsizedone. */
export function dirsize(request) {
  const listing = current();
  if (listing && !listing.trash) {
    const base = resolve(listing.path || ".");
    const indices = request.all === true ? listing.rows.map((_, i) => i)
      : Array.isArray(request.rows) ? request.rows.filter(Number.isInteger) : [];
    for (const i of indices) {
      const row = listing.rows[i];
      if (row?.dir) waiting.add(resolve(base, row.name));
    }
  }
  if (!job) run();
}

/** `dirsizecancel`: the run in flight stops and nothing waits any more. */
export function dirsizeCancel() {
  waiting.clear();
  if (!job) return send({ t: "dirsizedone", cancelled: true });
  job.cancelled = true;
  job.child?.kill();
}

const quotedNames = (errors) => {
  // GNU and bunmsh both quote the path: "du: cannot read directory './photos/2019': Permission denied".
  const names = new Set();
  for (const match of errors.matchAll(/'\.[\\/]([^\\/']+)/g)) names.add(match[1]);
  return names;
};

// The waiting folders that share the first one's parent: du runs there with "./name" operands, so a
// name starting with "-" stays a name and each printed name maps straight back.
function run() {
  if (!waiting.size) return send({ t: "dirsizedone", cancelled: false });
  const command = duCommand();
  if (!command) {
    waiting.clear();
    send({ t: "error", where: "dirsize", path: "", msg: "no du could be found to measure folders" });
    return send({ t: "dirsizedone", cancelled: false });
  }
  const parent = dirname(waiting.values().next().value);
  const here = [...waiting].filter((full) => dirname(full) === parent);
  for (const full of here) waiting.delete(full);
  const names = here.map((full) => "./" + full.slice(parent.length).replace(/^[\\/]+/, ""));
  const started = performance.now();
  const mine = (job = { cancelled: false, child: null });
  let child;
  try {
    child = Bun.spawn([...command, "-s", "-b", "-x", "-0", "--", ...names], { cwd: parent, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
  } catch (e) {
    job = null;
    send({ t: "error", where: "dirsize", path: parent, msg: String(e?.message ?? e) });
    return run();
  }
  mine.child = child;
  let errors = "";
  const answered = new Map();
  const answer = (name, bytes, partial) => {
    const full = resolve(parent, name);
    known.set(full, { bytes, partial });
    answered.set(name, bytes);
    if (mine.cancelled) return;
    const row = rowOf(full);
    if (row >= 0) send({ t: "dirsized", row, bytes, partial, ms: Number((performance.now() - started).toFixed(3)) });
  };
  const errorsDone = (async () => {
    for await (const chunk of child.stderr) errors += Buffer.from(chunk).toString();
  })();
  const stdoutDone = (async () => {
    let rest = "";
    const decoder = new TextDecoder();
    for await (const chunk of child.stdout) {
      rest += decoder.decode(chunk, { stream: true });
      let at;
      while ((at = rest.indexOf("\0")) >= 0) {
        const line = rest.slice(0, at);
        rest = rest.slice(at + 1);
        const tab = line.indexOf("\t");
        const bytes = Number(line.slice(0, tab));
        if (tab < 0 || !Number.isFinite(bytes)) continue;
        const name = line.slice(tab + 1).replace(/^\.[\\/]/, "");
        answer(name, bytes, quotedNames(errors).has(name));
      }
    }
  })();
  Promise.all([stdoutDone, errorsDone, child.exited]).then(() => {
    // A message that reached stderr after its folder's line still makes that folder a floor.
    const short = quotedNames(errors);
    for (const [name, bytes] of answered) if (short.has(name) && !known.get(resolve(parent, name))?.partial) answer(name, bytes, true);
    job = null;
    if (mine.cancelled) return send({ t: "dirsizedone", cancelled: true });
    run();
  });
}
