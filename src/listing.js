// One directory's rows: scanned for names first, stat'd only for the windows a client reads
// (docs/protocol.md "list", "window", "rows"). Upstream: src/backend/listing.rs.
import { accessSync, constants, lstatSync, readdirSync, readlinkSync, statSync } from "node:fs";
import { join, basename } from "node:path";
import { describeKind } from "./kinds.js";
import { NEEDS_STAT, sortRows } from "./order.js";
import { keptSize } from "./dirsize.js";

const S_IFMT = 0o170000,
  S_IFLNK = 0o120000;

export class Listing {
  constructor(path, rows) {
    this.path = path;
    this.rows = rows;
  }

  /** Names and the directory bit only; dotfiles never enter the listing unless `hidden`. */
  static scan(path, hidden) {
    const rows = [];
    for (const entry of readdirSync(path || ".", { withFileTypes: true })) {
      if (!hidden && entry.name.startsWith(".")) continue;
      // `d` is the link's own type, so a symlink to a directory is not a directory row.
      rows.push({ name: entry.name, dir: entry.isDirectory(), link: entry.isSymbolicLink() });
    }
    return new Listing(path, rows);
  }

  /** Reorders the rows, returning [read, sort] in milliseconds as `listed` reports them. */
  sort(order) {
    const started = performance.now();
    if (NEEDS_STAT.has(order.by)) for (const row of this.rows) this.stat(row);
    if (order.by === "size")
      for (const row of this.rows) row.measured = row.dir && !row.trash ? keptSize(join(this.path || ".", row.name))?.bytes : undefined;
    // Kind ordering compares the name's class alone, so it reads no file and pays no stat.
    if (order.by === "kind" || order.groupByKind)
      for (const row of this.rows) row.group ??= describeKind(row.trash ? basename(row.trash.original || row.name) : row.name, row.dir, 0, undefined).group;
    const sorting = performance.now();
    sortRows(this.rows, order);
    return [sorting - started, performance.now() - sorting];
  }

  stat(row) {
    if (row.st === undefined) {
      try {
        row.st = lstatSync((row.trash?.file ?? join(this.path, row.name)));
      } catch {
        row.st = null;
      }
    }
    return row.st;
  }

  /** One `rows` line's body for rows start..start+count, clamped to the listing. */
  window(start, count) {
    const started = performance.now();
    start = Math.min(Math.max(0, start | 0), this.rows.length);
    const end = Math.min(this.rows.length, start + Math.max(0, count | 0));
    const kinds = [],
      kindIndex = new Map(),
      out = [];
    for (let index = start; index < end; index++) out.push(this.describe(this.rows[index], kinds, kindIndex));
    return { start, rows: out, kinds, ms: performance.now() - started };
  }

  describe(row, kinds, kindIndex) {
    const st = this.stat(row);
    // A failed stat reports s, m and p all 0; p 0 is outside st_mode's domain, so it says so.
    const mode = st?.mode ?? 0;
    let link, target;
    if ((mode & S_IFMT) === S_IFLNK) {
      try {
        link = readlinkSync((row.trash?.file ?? join(this.path, row.name)));
      } catch {}
      // Only a link pays the second stat: it tells a working link from a broken one.
      try {
        target = statSync((row.trash?.file ?? join(this.path, row.name)));
      } catch {
        target = null;
      }
    }
    const { icon, kind } = describeKind(row.trash ? basename(row.trash.original || row.name) : row.name, row.dir, mode, target);
    if (!kindIndex.has(kind)) {
      kindIndex.set(kind, kinds.length);
      kinds.push(kind);
    }
    const out = {
      n: row.name,
      d: row.dir,
      s: st ? st.size : 0,
      m: st ? Math.floor(st.mtimeMs / 1000) : 0,
      p: mode,
      i: icon,
      t: false,
      k: kindIndex.get(kind),
    };
    if (row.trash) out.trash = {name: basename(row.trash.original || row.name), original: row.trash.original, deleted: row.trash.deleted, identity: row.trash.identity};
    if (link !== undefined) out.l = link;
    // A content search's matched line, drawn under the name in its results.
    if (row.match) out.g = row.match;
    if (row.dir) out.v = st ? st.dev : 0;
    // A folder the user already measured keeps its size on every later row: z, and zp for a floor.
    if (row.dir && !row.trash) {
      const kept = keptSize(join(this.path || ".", row.name));
      if (kept) {
        out.z = kept.bytes;
        if (kept.partial) out.zp = true;
      }
    }
    return out;
  }

  indexOfName(name) {
    return this.rows.findIndex((row) => row.name === name);
  }
}

/** The listed directory's own device id and whether this user may add or remove entries. */
export function directoryFacts(path) {
  let v = 0,
    w = false;
  try {
    v = statSync(path || ".").dev;
  } catch {}
  try {
    accessSync(path || ".", constants.W_OK | constants.X_OK);
    w = true;
  } catch {}
  return { v, w };
}
