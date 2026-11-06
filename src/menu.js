// The selected-item menu's `menuaction` requests (docs/protocol.md "menuaction identity and
// deletion"). Upstream: src/backend/menuaction*.rs.
//
// Ported: snapshot, which captures the selection's paths with each one's identity; activate and
// validate, which check those identities again and hand the paths back; close. Every other
// operation answers ok:false, so the menu says so instead of waiting.
import { constants, lstatSync } from "node:fs";
import { join } from "node:path";

const CHANGED = "Selected items changed; reopen the menu.";

// What a name holds: device, inode and file type.
const identity = (st) => `${st.dev}:${st.ino}:${st.mode & constants.S_IFMT}`;

// id -> { paths, cursor, identities }
const captured = new Map();

export function capturedPaths(menuId) {
  const held = captured.get(menuId);
  return held && unchanged(held) ? held.paths.slice() : null;
}

export function captureSelection(menuId) {
  const held = captured.get(menuId);
  return held && unchanged(held) ? { paths: held.paths.slice(), identities: held.identities.slice() } : null;
}

export function selectionItemUnchanged(held, index) {
  try { return identity(lstatSync(held.paths[index])) === held.identities[index]; }
  catch { return false; }
}

function unchanged(held) {
  if (held.cursor) {
    try { if (identity(lstatSync(held.cursor)) !== held.cursorIdentity) return false; }
    catch { return false; }
  }
  return held.paths.every((path, i) => {
    try {
      return identity(lstatSync(path)) === held.identities[i];
    } catch {
      return false;
    }
  });
}

export function menuaction(request, send, listing, stamp) {
  const id = request.id ?? 0,
    op = request.op ?? "",
    answer = (fields) => send({ t: "menuaction", id, op, ...fields });
  if (op === "snapshot") {
    captured.delete(id);
    if (request.listing !== undefined && request.listing !== stamp) return answer({ ok: false, error: CHANGED });
    let paths, cursor;
    if (Array.isArray(request.paths)) {
      paths = request.paths.map(String);
      cursor = typeof request.cursorPath === "string" ? request.cursorPath : (paths[0] ?? "");
    } else {
      if (request.listing !== undefined && request.listing !== stamp) return answer({ ok: false, error: CHANGED });
      const at = (index) => (listing?.rows[index] ? join(listing.path || ".", listing.rows[index].name) : null);
      paths = (request.rows ?? []).map(at);
      if (paths.some((p) => p === null)) return answer({ ok: false, error: CHANGED });
      cursor = at(request.cursor) ?? paths[0] ?? "";
    }
    const stats = [];
    for (const path of paths) {
      try {
        stats.push(lstatSync(path));
      } catch {
        return answer({ ok: false, error: CHANGED });
      }
    }
    let cursorIdentity;
    try { cursorIdentity = cursor ? identity(lstatSync(cursor)) : null; }
    catch { return answer({ ok: false, error: CHANGED }); }
    captured.set(id, { paths, cursor, cursorIdentity, identities: stats.map(identity) });
    return answer({ ok: true, count: paths.length, modes: stats.map((s) => s.mode), kinds: stats.map((s) => s.mode & constants.S_IFMT) });
  }
  const held = captured.get(id);
  if (op === "close") {
    captured.delete(id);
    return;
  }
  if (op === "activate" || op === "validate") {
    const action = String(request.action ?? "");
    if (!held || !unchanged(held)) return answer({ action, ok: false, error: CHANGED, paths: [] });
    const single = action.startsWith("taildrop:") || action === "sharelink";
    return answer({ action, ok: true, paths: single ? [held.cursor] : held.paths, ...(request.dest === undefined ? {} : { dest: request.dest }) });
  }
  answer({ ok: false, error: `${op || "That menu action"} is not ported to flea-qml yet.` });
}
