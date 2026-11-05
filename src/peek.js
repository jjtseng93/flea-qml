// A read-only look at a directory other than the listed one, for the columns view and the preview
// of a folder row; it never touches the listing (docs/protocol.md has no section yet).
// Upstream: src/backend/peek.rs.
import { lstatSync } from "node:fs";
import { describeKind } from "./kinds.js";
import { Listing, directoryFacts } from "./listing.js";
import { SORT_KEYS } from "./order.js";

const S_IFLNK = 0o120000;
// A column draws what fits on screen, so a peek at a huge directory is capped rather than streamed.
const PEEK_CAP = 512;

export function peek(request) {
  const path = request.path ?? "",
    first = request.first ?? 0,
    hidden = request.hidden === true,
    hiddenLast = request.hiddenLast === true;
  // The folder's remembered order is echoed only when the request carried one.
  const echo = typeof request.by === "string" ? { by: request.by, desc: request.desc === true } : {};
  const head = { t: "peeked", path, hidden, hiddenLast, first, ...echo };
  let listing;
  try {
    if (request.by !== undefined && !SORT_KEYS.has(request.by)) throw new Error("no such order");
    listing = Listing.scan(path, hidden);
  } catch {
    // Zero rows is also what an empty folder answers, so the line says which this is.
    let mode;
    try {
      mode = lstatSync(path || ".").mode;
    } catch {}
    return { ...head, n: 0, failed: true, ...(mode === undefined ? {} : { mode }), rows: [] };
  }
  listing.sort({ by: request.by ?? "name", desc: request.desc === true, foldersFirst: true, hiddenLast });
  const total = listing.rows.length,
    count = Math.min(first, PEEK_CAP, total);
  let start = 0;
  if (request.focus) {
    const index = listing.indexOfName(request.focus);
    if (index >= 0) start = Math.max(0, Math.min(index - Math.floor(count / 2), total - count));
  }
  const { v, w } = directoryFacts(path);
  // A peek row's mark comes from its name alone; a link draws as a link.
  const rows = listing.rows.slice(start, start + count).map((row) => ({
    n: row.name,
    d: row.dir,
    i: describeKind(row.name, row.dir, row.link ? S_IFLNK : 0, undefined).icon,
  }));
  return { ...head, n: total, v, w, rows };
}
