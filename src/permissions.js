// The Permissions card: `permissions` (inspect, apply, close) and `permissionsBatch`
// (docs/protocol.md "permissionsBatch"). Upstream: src/backend/permissions.rs.
// Upstream holds an O_PATH descriptor between inspect and apply; Node has none, so the item's
// device and inode are read again just before the chmod instead, and a link is never followed.
// Not yet: the undo journal.
import { chmodSync, lstatSync, readFileSync } from "node:fs";
import { isAbsolute } from "node:path";
import { userInfo } from "node:os";
import { fsTypeOf } from "./fsinfo.js";
import { reason as ioReason } from "./transfer.js";

const SPECIAL = 0o7000;
const CHANGED = "Selected item changed; reopen Permissions.";
const euid = () => (typeof process.geteuid === "function" ? process.geteuid() : -1);

/** "644" or "0644"; anything else refuses with the card's sentence. */
export function parseMode(text) {
  const ordinary = typeof text === "string" && (text.length === 3 || (text.length === 4 && text[0] === "0"));
  if (!ordinary || !/^[0-7]+$/.test(text)) throw Error("Enter three octal digits or a leading-zero four-digit mode.");
  return Number.parseInt(text, 8);
}

// Why an item is shown read-only, or "" when its owner may change it.
function readOnly(st) {
  for (const [bit, label] of [[0o4000, "setuid"], [0o2000, "setgid"], [0o1000, "sticky"]])
    if (st.mode & bit) return `Read-only: ${label} bit is present.`;
  const me = euid();
  if (me >= 0 && st.uid !== me) return "Read-only: you are not the owner.";
  return "";
}

// Sample input, /etc/passwd: "gm:x:1000:1000::/home/gm:/bin/bash"; field 2 is the uid, as in /etc/group the gid.
function nameIn(file, id) {
  try {
    for (const line of readFileSync(file, "utf8").split("\n")) {
      const fields = line.split(":");
      if (fields.length > 2 && Number(fields[2]) === id) return fields[0];
    }
  } catch {}
  return "";
}
function ownerName(uid) {
  const found = nameIn("/etc/passwd", uid);
  if (found) return found;
  try {
    const me = userInfo();
    if (me.uid === uid) return me.username;
  } catch {}
  return "";
}

const fmt = (mode) => (mode & 0o7777).toString(8).padStart(4, "0");
const sameItem = (a, b) => a.dev === b.dev && a.ino === b.ino;
const shape = (st) =>
  !st.isFile() && !st.isDirectory() ? "Permissions takes one item, not a link."
    : st.mode & SPECIAL ? "Special permissions cannot be edited." : "";
const sentence = (e) => (e?.code ? ioReason(e) : String(e?.message ?? e).replace(/\.$/, ""));

// chmod follows links, so the name is read again right before it and must still be the reviewed item.
function chmodChecked(path, held, target) {
  const now = lstatSync(path);
  if (!sameItem(now, held) || now.isSymbolicLink()) throw Error("the item was replaced, so its mode was left in place");
  if ((now.mode & 0o777) !== (held.mode & 0o777)) throw Error("the mode changed since, so it was left in place");
  chmodSync(path, target);
  if ((lstatSync(path).mode & 0o777) !== (target & 0o777)) {
    let fs = "";
    try {
      fs = fsTypeOf(lstatSync(path, { bigint: true }).dev);
    } catch {}
    // A fixed-mask filesystem answers success and keeps its mode.
    throw Error(`This ${fs ? fs + " " : ""}drive ignores permission changes, so nothing was changed`);
  }
}

// The card holds one reviewed item per request id.
const held = new Map();

export function permissions(request, send) {
  const id = request.id ?? 0,
    op = String(request.op ?? "");
  const answer = (fields) => send({ t: "permissions", id, op, ...fields });
  const fail = (error) => answer({ ok: false, error });
  if (op === "close") {
    held.delete(id);
    return answer({ ok: true });
  }
  if (op === "inspect") {
    held.delete(id);
    const path = request.path;
    if (!id || typeof path !== "string" || !isAbsolute(path)) return fail("Permissions requires an absolute path and request identity.");
    let st;
    try {
      st = lstatSync(path);
    } catch (e) {
      return fail(`Could not inspect permissions: ${ioReason(e)}.`);
    }
    if (!st.isFile() && !st.isDirectory()) return fail("Permissions takes one item, not a link.");
    held.set(id, { path, st });
    return answer({ ok: true, path, directory: st.isDirectory(), mode: fmt(st.mode), uid: st.uid, gid: st.gid,
      owner: ownerName(st.uid), group: nameIn("/etc/group", st.gid), reason: readOnly(st) });
  }
  if (op === "apply") {
    let target;
    try {
      target = parseMode(request.mode);
    } catch (e) {
      return fail(e.message);
    }
    const item = held.get(id);
    if (!item) return fail(CHANGED);
    let now;
    try {
      now = lstatSync(item.path);
    } catch {
      return fail("Selected item moved or disappeared; reopen Permissions.");
    }
    if (!sameItem(now, item.st) || now.isSymbolicLink()) return fail(CHANGED);
    const why = readOnly(now) || shape(now);
    if (why) return fail(why);
    try {
      chmodChecked(item.path, now, target);
    } catch (e) {
      return fail(`Could not change mode: ${sentence(e)}. No change was applied.`);
    }
    held.set(id, { path: item.path, st: lstatSync(item.path) });
    send({ t: "changed", path: item.path.replace(/\/[^/]*$/, "") || "/" });
    return answer({ ok: true, mode: fmt(target) });
  }
  fail("Unknown permissions operation.");
}

// Every path to its own mode, all or none: a failure partway puts back what changed, newest first.
// "u+x" adds the owner's execute bit to whatever mode the item has.
export function permissionsBatch(request, send) {
  const id = request.id ?? 0;
  const answer = (ok, mode, error) => send({ t: "permissions", id, op: "applyMany", ok, mode, error });
  const { paths, modes } = request;
  if (!Array.isArray(paths) || !Array.isArray(modes) || paths.length === 0 || paths.length !== modes.length)
    return answer(false, "", "Permissions needs at least one selected item.");
  const checked = [];
  try {
    for (let i = 0; i < paths.length; i++) {
      const path = paths[i],
        text = modes[i];
      if (typeof path !== "string" || !isAbsolute(path)) throw Error("Permissions requires an absolute path and request identity.");
      const absolute = text === "u+x" ? null : parseMode(text);
      let st;
      try {
        st = lstatSync(path);
      } catch (e) {
        throw Error(`Could not inspect permissions: ${ioReason(e)}.`);
      }
      const why = shape(st) || readOnly(st);
      if (why) throw Error(why);
      checked.push({ path, st, target: absolute ?? ((st.mode & 0o777) | 0o100) });
    }
  } catch (e) {
    return answer(false, "", e.message);
  }
  const applied = [];
  for (const item of checked) {
    try {
      chmodChecked(item.path, item.st, item.target);
      applied.push(item);
    } catch (e) {
      const failure = `Could not change mode: ${sentence(e)}.`;
      let stuck = 0;
      for (const done of applied.reverse()) {
        try {
          chmodSync(done.path, done.st.mode & 0o777);
        } catch {
          stuck++;
        }
      }
      return answer(false, "", stuck ? `${failure} ${stuck} of ${checked.length} items stayed changed.` : `${failure} No change was applied.`);
    }
  }
  for (const folder of new Set(checked.map((item) => item.path.replace(/\/[^/]*$/, "") || "/"))) send({ t: "changed", path: folder });
  answer(true, fmt(checked[0].target), "");
}
