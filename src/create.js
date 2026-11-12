// Making things: `mkdir`, the menu's `newfile` and `duplicate` (docs/protocol.md "mkdir",
// "duplicate"). Upstream: src/backend/opsdispatch.rs, menu_actions.rs `create_file`, ops.rs.
// Not yet: the undo journal, so nothing made here can be undone.
import { lstatSync, mkdirSync, openSync, closeSync } from "node:fs";
import { basename, dirname, join, isAbsolute } from "node:path";
import { capturedPaths } from "./menu.js";
import { copyName, copyTree, reason } from "./transfer.js";

const NAME_TRIES = 1000;
const slash = (path) => (process.platform === "win32" ? path.replaceAll("\\", "/") : path);

/** A bare name in one folder: not empty, not `.` or `..`, no separator and no NUL. */
export function validName(name) {
  return typeof name === "string" && name !== "" && name !== "." && name !== ".." && !/[/\0]/.test(name)
    && !(process.platform === "win32" && name.includes("\\"));
}

const exists = (path) => {
  try {
    lstatSync(path);
    return true;
  } catch {
    return false;
  }
};

// The mkdir sentences of src/error.rs, which the client words as they come.
const mkdirReason = (e) =>
  ({
    EEXIST: "a folder or file with that name already exists",
    ENOENT: "item not found",
    ENOTDIR: "item not found",
    EACCES: "permission denied",
    EPERM: "permission denied",
    EROFS: "the drive is read-only",
    ENAMETOOLONG: "that name is too long",
    ENOSPC: "the drive is full",
  })[e?.code] ?? String(e?.message ?? e);

// An opted-in `request` adds itself to the success line and sends the creation receipt after it.
function receipt(send, request, kind, fields) {
  const id = request.request;
  if (!Number.isSafeInteger(id) || id <= 0) return;
  send({ t: "menuaction", op: "creation", id, kind, ...fields });
}

export function mkdir(request, send) {
  const parent = request.path;
  const fail = (msg) => {
    send({ t: "error", where: "mkdir", path: String(parent ?? ""), msg });
    receipt(send, request, "made", { ok: false, error: msg });
  };
  if (typeof parent !== "string" || !isAbsolute(parent)) return fail("the folder is not an absolute path");
  const typed = typeof request.name === "string" && request.name !== "";
  if (typed && !validName(request.name)) return fail("that name is not allowed");
  // A typed name is never renumbered; no name takes the first free New Folder.
  for (let n = 1; n <= (typed ? 1 : NAME_TRIES); n++) {
    const name = typed ? request.name : n === 1 ? "New Folder" : `New Folder ${n}`,
      path = join(parent, name);
    try {
      mkdirSync(path);
    } catch (e) {
      if (e?.code === "EEXIST" && !typed) continue;
      return fail(mkdirReason(e));
    }
    const id = request.request;
    send({ t: "made", ok: true, path: slash(path), ...(Number.isSafeInteger(id) && id > 0 ? { request: id } : {}) });
    receipt(send, request, "made", { ok: true, path: slash(path) });
    send({ t: "changed", path: slash(parent) });
    return;
  }
  fail("every New Folder name is already taken");
}

// The New file card: one empty file, created exclusively, so neither a file nor a dangling link
// already at that name is ever opened.
export function newfile(request, send) {
  const answer = (fields) => send({ t: "menuaction", id: request.id ?? 0, op: "newFile", ...fields });
  const parent = request.path,
    name = request.name;
  if (typeof parent !== "string" || !isAbsolute(parent) || !validName(name))
    return answer({ ok: false, error: "New File requires an absolute folder and one non-empty filename." });
  const path = join(parent, name);
  try {
    closeSync(openSync(path, "wx", 0o666));
  } catch (e) {
    return answer({ ok: false, error: `Could not create ${path}: ${reason(e)}.` });
  }
  answer({ ok: true, path: slash(path) });
  send({ t: "changed", path: slash(parent) });
}

// Copies one path to its first free " copy" sibling; a folder duplicates its whole tree.
let duplicating = Promise.resolve();
export function duplicate(request, send) {
  const run = () => duplicateOne(request, send);
  duplicating = duplicating.then(run, run);
}

async function duplicateOne(request, send) {
  const source = request.path;
  const fail = (msg) => {
    send({ t: "error", where: "duplicate", path: String(source ?? ""), msg });
    receipt(send, request, "duplicated", { ok: false, error: msg });
  };
  if (typeof source !== "string" || !isAbsolute(source)) return fail("the path is not absolute");
  if (request.menuId && !capturedPaths(request.menuId)?.includes(source)) return fail("Selected item changed; reopen the menu.");
  if (!exists(source)) return fail("it no longer exists");
  const folder = dirname(source),
    name = basename(source);
  let target = null;
  for (let n = 1; n <= NAME_TRIES && !target; n++) {
    const candidate = join(folder, copyName(name, n));
    if (!exists(candidate)) target = candidate;
  }
  if (!target) return fail("every copy name for this item is already taken");
  try {
    await copyTree(source, target);
  } catch (e) {
    // A copy that failed partway leaves its partial sibling, as upstream does, and the folder shows it.
    send({ t: "changed", path: slash(folder) });
    return fail(e?.sentence ?? reason(e));
  }
  const id = request.request;
  send({ t: "duplicated", ok: true, path: slash(target), ...(Number.isSafeInteger(id) && id > 0 ? { request: id } : {}) });
  receipt(send, request, "duplicated", { ok: true, path: slash(target) });
  send({ t: "changed", path: slash(folder) });
}
