// The selected-item menu's `menuaction` requests (docs/protocol.md "menuaction identity and
// deletion"). Upstream: src/backend/menuaction*.rs.
//
// Ported: snapshot, which captures the selection's paths with each one's identity; activate and
// validate, which check those identities again and hand the paths back; close; and Delete
// permanently's prepareDelete, checkDelete, refreshDelete and delete, which remove only what the
// confirmation reviewed. Every other operation answers ok:false, so the menu says so instead of
// waiting.
import { constants, lstatSync, readdirSync, rmSync } from "node:fs";
import { dirname, join, resolve, isAbsolute } from "node:path";

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
  if (op === "prepareDelete" || op === "refreshDelete") {
    if (!held) return answer({ ok: false, error: CHANGED });
    // A refresh reviews only the paths already captured: missing ones drop out, replaced ones are
    // captured anew, and nothing outside them can join.
    held.token = undefined;
    held.review = undefined;
    if (op === "refreshDelete") {
      const kept = [];
      for (const path of held.paths)
        try {
          kept.push([path, identity(lstatSync(path))]);
        } catch {}
      held.paths = kept.map(([path]) => path);
      held.identities = kept.map(([, id]) => id);
      held.cursor = held.paths[0] ?? "";
      held.cursorIdentity = held.identities[0];
    } else if (!unchanged(held)) return answer({ ok: false, error: CHANGED });
    if (!held.paths.length) return answer({ ok: false, error: "Nothing selected is still there." });
    try {
      held.review = reviewTrees(held.paths);
      if (!unchanged(held)) throw new Error(CHANGED);
      held.token = ++deleteTokens;
      return answer({ ok: true, token: held.token, count: held.paths.length, bytes: held.review.bytes, partial: false });
    } catch (error) { return answer({ ok: false, error: error.message }); }
  }
  if (op === "checkDelete") {
    return answer({ ok: true, valid: !!held && held.token !== undefined && held.token === request.token && reviewUnchanged(held) });
  }
  if (op === "delete") {
    // Only the token the confirmation showed deletes, once; a changed selection asks for a fresh review.
    if (!held || held.token === undefined || held.token !== request.token || !reviewUnchanged(held))
      return answer({ ok: false, stale: true, error: CHANGED });
    held.token = undefined;
    let deleted = 0,
      firstError = "";
    const remaining = [],
      folders = new Set();
    held.paths.forEach((path, index) => {
      try {
        // Checked again just before the removal, so a name swapped since the review is left alone.
        if (identity(lstatSync(path)) !== held.identities[index]) throw new Error(CHANGED);
        // A link is removed as a link; rm never follows one into its target.
        rmSync(path, { recursive: true, force: false });
        deleted++;
        folders.add(dirname(path));
      } catch (e) {
        firstError ||= e.code === "EACCES" || e.code === "EPERM" ? "permission denied" : e.message;
        try {
          if (identity(lstatSync(path)) === held.identities[index]) remaining.push(path);
        } catch {}
      }
    });
    const failed = held.paths.length - deleted;
    answer({ ok: true, deleted, failed, cancelled: false, error: failed ? firstError : "", remaining });
    for (const path of folders) send({ t: "changed", path });
    return;
  }
  answer({ ok: false, error: `${op || "That menu action"} is not ported to flea-qml yet.` });
}

let deleteTokens = 0;

// Bounded, non-following review. A confirmation cannot silently include newly added
// or replaced descendants. No path-based check makes concurrent filesystem mutation atomic.
export function reviewTrees(paths) {
  const rows = [], pending = paths.map(path => ({ path, dev: null }));
  const deadline = performance.now() + 2000;
  let bytes = 0;
  while (pending.length) {
    if (rows.length >= 100000 || performance.now() > deadline) throw new Error("The selected trees are too large to review safely.");
    const { path, dev } = pending.pop();
    if (!isAbsolute(path) || resolve(path) === dirname(resolve(path))) throw new Error("Refusing to delete a filesystem root or relative path.");
    const st = lstatSync(path);
    if (dev !== null && st.dev !== dev) throw new Error("Refusing to delete across a mounted filesystem.");
    rows.push([path, identity(st), st.size, st.mtimeMs, st.ctimeMs]);
    if (st.isDirectory()) {
      for (const name of readdirSync(path).sort().reverse()) pending.push({path: join(path, name), dev: st.dev});
    } else bytes += st.size;
  }
  return { rows, bytes };
}
function reviewUnchanged(held) {
  if (!held.review || !unchanged(held)) return false;
  try { return JSON.stringify(reviewTrees(held.paths).rows) === JSON.stringify(held.review.rows); }
  catch { return false; }
}
