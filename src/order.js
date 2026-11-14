// Row ordering (docs/protocol.md "sort"). Upstream: src/backend/sort.rs, ordering.rs.

import { basename } from "node:path";

const isDigit = (c) => c >= 48 && c <= 57;
const lower = (c) => (c >= 65 && c <= 90 ? c + 32 : c);
const encoder = new TextEncoder();

// macOS Finder's order rather than a raw byte compare: a run of digits compares by value, so
// file_2 precedes file_10; ASCII letters compare case-insensitively; leading zeros do not count.
// Like upstream, bytes above 0x7f fall back to byte (code point) order.
function finderCompare(a, b) {
  let i = 0,
    j = 0;
  while (i < a.length && j < b.length) {
    if (isDigit(a[i]) && isDigit(b[j])) {
      const [aEnd, aSig] = digitRun(a, i),
        [bEnd, bSig] = digitRun(b, j);
      const order = aEnd - aSig - (bEnd - bSig) || compareBytes(a.subarray(aSig, aEnd), b.subarray(bSig, bEnd));
      if (order) return order;
      i = aEnd;
      j = bEnd;
      continue;
    }
    const ca = lower(a[i]),
      cb = lower(b[j]);
    if (ca !== cb) return ca - cb;
    i++;
    j++;
  }
  return a.length - i - (b.length - j);
}
function digitRun(s, at) {
  let end = at;
  while (end < s.length && isDigit(s[end])) end++;
  let sig = at;
  // A run of nothing but zeros keeps one, so it compares as a single zero.
  while (sig < end - 1 && s[sig] === 48) sig++;
  return [end, sig];
}
function compareBytes(a, b) {
  for (let k = 0; k < Math.min(a.length, b.length); k++) if (a[k] !== b[k]) return a[k] - b[k];
  return a.length - b.length;
}

const bytesOf = (row) => (row.bytes ??= encoder.encode(row.trash ? basename(row.trash.original || row.name) : row.name));

/** Finder order, then byte order, so two names never compare equal unless they are. */
export function nameOrder(a, b) {
  return finderCompare(bytesOf(a), bytesOf(b)) || compareBytes(bytesOf(a), bytesOf(b));
}

export function extensionOf(name) {
  const dot = name.lastIndexOf(".");
  return dot > 0 && dot < name.length - 1 ? name.slice(dot + 1) : null;
}
function extensionOrder(a, b) {
  const ea = extensionOf(a.trash?.original || a.name),
    eb = extensionOf(b.trash?.original || b.name);
  if (ea === null || eb === null) return (ea === null ? 0 : 1) - (eb === null ? 0 : 1);
  return finderCompare(encoder.encode(ea), encoder.encode(eb));
}

export const SORT_KEYS = new Set(["name", "size", "mtime", "date", "kind", "extension"]);
/** Orders that read every row's lstat first; the rest work on names alone. */
export const NEEDS_STAT = new Set(["size", "mtime", "date"]);

/**
 * Sorts rows in place. `row.dir` and `row.name` are always there; `row.st` is there for every row
 * when `by` needs a stat, and `row.group` (kinds.js's class, e.g. "image") when it is "kind" or
 * kinds group.
 */
// A file's own size; a folder's is the size the user measured (src/dirsize.js), never its dirent's.
const sizeOf = (row) => (row.dir ? row.measured ?? 0 : row.st?.size ?? 0);

export function sortRows(rows, { by = "name", desc = false, foldersFirst = true, groupByKind = false, hiddenLast = false }) {
  const key =
    by === "size"
      ? (a, b) => sizeOf(a) - sizeOf(b)
      : by === "mtime" || by === "date"
        ? (a, b) => (a.trash ? Date.parse(a.trash.deleted)||0 : a.st?.mtimeMs ?? 0) - (b.trash ? Date.parse(b.trash.deleted)||0 : b.st?.mtimeMs ?? 0)
        : by === "kind"
          ? (a, b) => (a.dir || b.dir ? 0 : (a.group < b.group ? -1 : a.group > b.group ? 1 : 0) || extensionOrder(a, b))
          : by === "extension"
            ? (a, b) => (a.dir || b.dir ? 0 : extensionOrder(a, b))
            : () => 0;
  const directional = (a, b) => {
    if (by === "size" && a.dir && b.dir && a.measured === undefined && b.measured === undefined) return nameOrder(a, b);
    const order = key(a, b) || nameOrder(a, b);
    return desc ? -order : order;
  };
  // Groups never reverse with `desc`: hidden last outermost, then kind groups or folders first.
  // flea-qml: a size order never measures; a folder nobody measured sorts after the measured ones,
  // by name, in either direction.
  const group = (row) =>
    (hiddenLast && row.name.startsWith(".") ? 10 : 0) +
    (groupByKind ? (row.dir ? 0 : row.group === "image" ? 1 : 2) : foldersFirst && !row.dir ? 1 : 0) +
    (by === "size" && row.dir && row.measured === undefined ? 0.5 : 0);
  rows.sort((a, b) => group(a) - group(b) || directional(a, b));
}
