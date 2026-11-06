// The `trash` request (docs/protocol.md "trash"): each path moves into the freedesktop Trash.
// Upstream runs `gio trash`; flea-qml runs no outside program, so this follows the FreeDesktop.org
// Trash specification 1.0 itself: the item is renamed into `files/`, after a `.trashinfo` record
// naming its original path is created exclusively in `info/`, which also reserves the name.
//
// Which Trash: the home Trash ($XDG_DATA_HOME/Trash) for an item on the same filesystem; otherwise
// the top directory's `.Trash/$uid` when that `.Trash` is a real, sticky folder, else
// `.Trash-$uid`, made if missing. An item is never copied between filesystems: a drive with no
// usable Trash fails that item and leaves it in place. Every system keeps this same Trash,
// Windows included: flea's Trash is this folder, not the Recycle Bin.
import { closeSync, constants, lstatSync, mkdirSync, openSync, renameSync, statSync, unlinkSync, writeSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, relative, resolve, sep, isAbsolute } from "node:path";

const NAME_TRIES = 1000;

const homeTrash = () => join(process.env.XDG_DATA_HOME || join(homedir(), ".local", "share"), "Trash");

// Percent-encoding as the specification asks for Path: every byte outside the unreserved set and '/'.
function encodePath(path) {
  let out = "";
  for (const byte of Buffer.from(path)) {
    const c = String.fromCharCode(byte);
    out += byte < 128 && /[A-Za-z0-9\-_.~/]/.test(c) ? c : `%${byte.toString(16).toUpperCase().padStart(2, "0")}`;
  }
  return out;
}

// Local time without a zone, YYYY-MM-DDThh:mm:ss, as the specification's DeletionDate.
function deletionDate(now = new Date()) {
  const two = (n) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${two(now.getMonth() + 1)}-${two(now.getDate())}T${two(now.getHours())}:${two(now.getMinutes())}:${two(now.getSeconds())}`;
}

// The highest folder above `path` still on its device: the mount's top directory.
function topDirectory(path, dev) {
  let top = dirname(path);
  for (;;) {
    const up = dirname(top);
    if (up === top) return top;
    try {
      if (statSync(up).dev !== dev) return top;
    } catch {
      return top;
    }
    top = up;
  }
}

function usableTrash(trash) {
  // Never follow a pre-existing symlink for a user-owned Trash or its children.
  for (const path of [trash, join(trash, "files"), join(trash, "info")]) {
    try { mkdirSync(path, { mode: 0o700 }); }
    catch (error) { if (error.code !== "EEXIST") throw error; }
    const st = lstatSync(path);
    if (!st.isDirectory() || (process.getuid && (st.uid !== process.getuid() || (st.mode & 0o077))))
      throw Object.assign(new Error("Trash directory is not private and owned by this user"), {code: "EUNSAFETRASH"});
  }
  return trash;
}

// { trash, base } for an item: base is what Path= is relative to ("" for the home Trash).
function trashFor(path, st) {
  // The home Trash is made first, so its own device is what the item is compared with; on Windows
  // ~/.local/share does not exist until flea makes it.
  try {
    const destination = homeTrash();
    mkdirSync(dirname(destination), {recursive: true, mode: 0o700});
    const home = usableTrash(destination);
    if (statSync(home).dev === st.dev) return { trash: home, base: "" };
  } catch (error) { if (error.code === "EUNSAFETRASH") throw error; }
  // Windows has no uid; one user per profile, so the per-drive folder is .Trash-0 there.
  const uid = process.getuid?.() ?? 0,
    top = topDirectory(path, st.dev);
  // $topdir/.Trash/$uid only when .Trash is a real folder with the sticky bit, never a link.
  try {
    const shared = lstatSync(join(top, ".Trash"));
    if (shared.isDirectory() && shared.mode & constants.S_ISVTX) return { trash: usableTrash(join(top, ".Trash", String(uid))), base: top };
  } catch {}
  return { trash: usableTrash(join(top, `.Trash-${uid}`)), base: top };
}

// Reserves a name in the Trash by creating its .trashinfo exclusively, then writes the record.
function reserve(trash, name, record) {
  for (let n = 1; n <= NAME_TRIES; n++) {
    const candidate = n === 1 ? name : `${name}.${n}`;
    let fd;
    try {
      fd = openSync(join(trash, "info", `${candidate}.trashinfo`), "wx", 0o600);
    } catch (e) {
      if (e.code === "EEXIST") continue;
      throw e;
    }
    const info = join(trash, "info", `${candidate}.trashinfo`);
    try {
      const bytes = Buffer.from(record);
      for (let offset = 0; offset < bytes.length;) {
        const written = writeSync(fd, bytes, offset, bytes.length - offset);
        if (!written) throw new Error("Could not write Trash metadata");
        offset += written;
      }
    } catch (error) {
      try { unlinkSync(info); } catch {}
      throw error;
    } finally { closeSync(fd); }
    // An orphan file still owns its name. Only ENOENT means it is free.
    let exists = false;
    try { lstatSync(join(trash, "files", candidate)); exists = true; }
    catch (error) {
      if (error.code !== "ENOENT") { unlinkSync(info); throw error; }
    }
    if (exists) { unlinkSync(info); continue; }
    return candidate;
  }
  throw new Error("every Trash name for this item is taken");
}

// Moves one item to the Trash; throws with a sentence when it cannot.
export function trashOne(path) {
  if (!isAbsolute(path) || resolve(path) === dirname(resolve(path))) throw new Error("Refusing to trash a filesystem root or relative path");
  const full = resolve(path),
    st = lstatSync(full);
  let where;
  try {
    where = trashFor(full, st);
  } catch {
    throw new Error("This drive has no Trash that could be used, so the item was left in place");
  }
  if (full === where.trash || full.startsWith(where.trash + sep) || where.trash.startsWith(full + sep)) throw new Error("That item is already in the Trash");
  const original = where.base ? relative(where.base, full) : full;
  const record = `[Trash Info]\nPath=${encodePath(original)}\nDeletionDate=${deletionDate()}\n`;
  const name = reserve(where.trash, basename(full), record);
  try {
    const current = lstatSync(full);
    if (current.dev !== st.dev || current.ino !== st.ino || (current.mode & constants.S_IFMT) !== (st.mode & constants.S_IFMT))
      throw new Error("Selected item changed; try again");
    renameSync(full, join(where.trash, "files", name));
  } catch (e) {
    unlinkSync(join(where.trash, "info", `${name}.trashinfo`));
    throw e.code === "EXDEV" ? new Error("This drive has no Trash that could be used, so the item was left in place") : e;
  }
}

const reason = (e) =>
  ({ EACCES: "permission denied", EPERM: "permission denied", ENOENT: "it no longer exists", EROFS: "the drive is read-only", EBUSY: "the item is in use" })[e?.code] ??
  String(e?.message ?? e);

// The whole request: trashstarted, then one trashed line, then changed for each folder touched.
export function trash(request, send, named) {
  const id = request.id ?? 0,
    paths = named.paths;
  send({ t: "trashstarted", id, n: paths.length, cancellable: false });
  const moved = [],
    folders = new Set();
  let firstError = "";
  for (const path of paths) {
    try {
      trashOne(path);
      moved.push(path);
      folders.add(dirname(path));
    } catch (e) {
      firstError ||= reason(e);
    }
  }
  const failed = paths.length - moved.length;
  send({ t: "trashed", id, ok: moved.length, failed, moved, ...(failed ? { err: firstError } : {}) });
  for (const path of folders) send({ t: "changed", path });
}
