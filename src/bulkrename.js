// `bulkrename` (docs/protocol.md "bulkrename"). Upstream: src/backend/bulkrename.rs.
// The whole batch is checked before anything moves; swaps and cycles go through temporary names in
// the same folder. A failure partway puts back what had moved, newest first. Not yet: the undo
// journal, so a finished batch cannot be undone.
import { lstatSync } from "node:fs";
import { basename, dirname, join, resolve, isAbsolute } from "node:path";
import { renameWithTrashRecord } from "./trash-record.js";
import { reason } from "./transfer.js";

const slash = (path) => (process.platform === "win32" ? path.replaceAll("\\", "/") : path);
const lstatOrNull = (path) => {
  try {
    return lstatSync(path);
  } catch {
    return null;
  }
};

/** The refusal for a batch, or "" when every rename may run. */
export function checkBatch(paths, names) {
  if (!Array.isArray(paths) || !Array.isArray(names) || paths.length === 0) return "nothing to rename";
  if (paths.length !== names.length) return "the names do not match the items";
  const seen = new Set(),
    taken = new Set();
  let folder = null;
  for (let i = 0; i < paths.length; i++) {
    const path = paths[i],
      name = names[i];
    if (typeof path !== "string" || !isAbsolute(path)) return "every item needs an absolute path";
    const full = resolve(path);
    if (seen.has(full)) return `${basename(path)} is named twice`;
    seen.add(full);
    if (folder === null) folder = dirname(full);
    else if (dirname(full) !== folder) return "every item must be in the same folder";
    if (!lstatOrNull(full)) return `${basename(path)} no longer exists`;
    if (typeof name !== "string" || name === "" || name === "." || name === "..") return "a new name is empty or not allowed";
    if (/[/\0\r\n]/.test(name) || (process.platform === "win32" && name.includes("\\"))) return `${name} is not an allowed name`;
    if (Buffer.byteLength(name) > 255) return `${name.slice(0, 40)}… is too long`;
    if (taken.has(name)) return `two items would both be named ${name}`;
    taken.add(name);
  }
  // A destination already there is refused unless it is itself one of the batch, which moves away first.
  for (let i = 0; i < paths.length; i++) {
    const target = join(folder, names[i]);
    if (target !== resolve(paths[i]) && !seen.has(target) && lstatOrNull(target)) return `${names[i]} already exists`;
  }
  return "";
}

export function bulkrename(request, send) {
  const { paths, names } = request;
  const problem = checkBatch(paths, names);
  if (problem) return send({ t: "error", where: "bulkrename", path: "", msg: problem });
  const folder = dirname(resolve(paths[0]));
  const moves = [];
  let unchanged = 0;
  for (let i = 0; i < paths.length; i++) {
    const from = resolve(paths[i]),
      to = join(folder, names[i]);
    if (from === to) unchanged++;
    else moves.push({ from, to });
  }
  // Every source steps aside to a temporary name first, so a to b and b to a never meet.
  const done = [];
  const tag = `.flea-rename-${process.pid}-${Date.now().toString(36)}`;
  try {
    moves.forEach((move, i) => {
      move.temp = join(folder, `${tag}-${i}`);
      if (lstatOrNull(move.temp)) throw Object.assign(Error("a temporary name is taken"), { code: "EEXIST" });
      renameWithTrashRecord(move.from, move.temp);
      done.push({ from: move.from, to: move.temp });
    });
    for (const move of moves) {
      if (lstatOrNull(move.to)) throw Object.assign(Error(`${basename(move.to)} appeared meanwhile`), { code: "EEXIST" });
      renameWithTrashRecord(move.temp, move.to);
      done.push({ from: move.temp, to: move.to });
    }
  } catch (e) {
    // Put back what moved, newest first; what cannot go back is named.
    const stuck = [];
    for (const step of done.reverse()) {
      try {
        renameWithTrashRecord(step.to, step.from);
      } catch {
        stuck.push(basename(step.to));
      }
    }
    send({ t: "changed", path: slash(folder) });
    const why = e?.code === "EEXIST" ? e.message : reason(e);
    return send({ t: "error", where: "bulkrename", path: slash(folder),
      msg: stuck.length ? `${why}; ${stuck.join(", ")} could not be put back` : `${why}; nothing was renamed` });
  }
  send({ t: "bulkrenamed", ok: moves.length, unchanged });
  send({ t: "changed", path: slash(folder) });
}
