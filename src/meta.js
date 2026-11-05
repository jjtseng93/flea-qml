// The `meta` line: the facts one row's preview asks for and a listing row does not carry
// (docs/protocol.md "meta"). Everything here is read by this process from the file itself; no tool
// is run. Upstream: src/backend/meta.rs, metareq.rs, archivelist.rs.
// Not read yet: media duration and rate, EXIF orientation and camera facts, RAW previews, owners.
import { closeSync, fstatSync, lstatSync, openSync, readSync, readlinkSync, statSync, constants } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";

// A line count stops here and says it is a floor (`partial`).
const LINE_BUDGET = 1 << 20;
// A tile lists this many archive names and states the rest as "+ N more".
const ARCHIVE_NAME_CAP = 64;
// A compressed tar is inflated whole to be listed, so a big one is left unread.
const TGZ_LIMIT = 64 << 20;

const blank = () => ({
  w: 0, h: 0, orient: 1, ms: 0, rate: 0,
  entries: 0, unpacked: 0, afailed: false, names: [],
  lines: 0, partial: false, lfailed: false, frames: 0,
  photo: null, target: "", targetdir: false, raw: null, owner: "",
});

// Reads up to `length` bytes from the start of a regular file; null for anything else. The open is
// non-blocking and re-checked on the descriptor, so a FIFO swapped in after the stat is never waited on.
function head(path, length) {
  let fd;
  try {
    if (!statSync(path).isFile()) return null;
    fd = openSync(path, constants.O_RDONLY | (constants.O_NONBLOCK ?? 0));
    const st = fstatSync(fd);
    if (!st.isFile()) return null;
    const buffer = Buffer.alloc(Math.min(length, st.size));
    const read = readSync(fd, buffer, 0, buffer.length, 0);
    return { bytes: buffer.subarray(0, read), size: st.size };
  } catch {
    return null;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

// Stored pixel size from the header of a PNG, GIF, BMP, WebP or JPEG; null for anything else.
function imageSize(b) {
  if (b.length >= 24 && b.readUInt32BE(0) === 0x89504e47) return [b.readUInt32BE(16), b.readUInt32BE(20)];
  if (b.length >= 10 && b.toString("latin1", 0, 4) === "GIF8") return [b.readUInt16LE(6), b.readUInt16LE(8)];
  if (b.length >= 26 && b.toString("latin1", 0, 2) === "BM") return [b.readInt32LE(18), Math.abs(b.readInt32LE(22))];
  if (b.length >= 30 && b.toString("latin1", 0, 4) === "RIFF" && b.toString("latin1", 8, 12) === "WEBP") {
    const chunk = b.toString("latin1", 12, 16);
    if (chunk === "VP8 ") return [b.readUInt16LE(26) & 0x3fff, b.readUInt16LE(28) & 0x3fff];
    if (chunk === "VP8L") {
      const bits = b.readUInt32LE(21);
      return [(bits & 0x3fff) + 1, ((bits >> 14) & 0x3fff) + 1];
    }
    if (chunk === "VP8X") return [b.readUIntLE(24, 3) + 1, b.readUIntLE(27, 3) + 1];
  }
  if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8) {
    for (let at = 2; at + 9 < b.length; ) {
      if (b[at] !== 0xff) return null;
      const marker = b[at + 1];
      // Start of frame: every SOFn but DHT (C4), JPG (C8) and DAC (CC).
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker))
        return [b.readUInt16BE(at + 7), b.readUInt16BE(at + 5)];
      at += 2 + b.readUInt16BE(at + 2);
    }
  }
  return null;
}

function countLines(path, meta) {
  const file = head(path, LINE_BUDGET);
  if (!file) {
    meta.lfailed = true;
    return;
  }
  // The newlines in a bitmap are a number nothing should be shown.
  if (imageSize(file.bytes)) return;
  let lines = 0;
  for (const byte of file.bytes) if (byte === 10) lines++;
  meta.lines = lines;
  meta.partial = file.size > file.bytes.length;
}

function addEntry(meta, name, isDir, size) {
  meta.entries++;
  meta.unpacked += size;
  if (meta.names.length < ARCHIVE_NAME_CAP) meta.names.push({ n: name, d: isDir });
}

// A zip's central directory, found from its end record.
function listZip(b, meta) {
  const from = Math.max(0, b.length - 65557);
  let end = -1;
  for (let i = b.length - 22; i >= from; i--)
    if (b.readUInt32LE(i) === 0x06054b50) {
      end = i;
      break;
    }
  if (end < 0) throw new Error("no end of central directory");
  const count = b.readUInt16LE(end + 10);
  let at = b.readUInt32LE(end + 16);
  for (let i = 0; i < count; i++) {
    if (b.readUInt32LE(at) !== 0x02014b50) throw new Error("bad central directory");
    const size = b.readUInt32LE(at + 24),
      nameLength = b.readUInt16LE(at + 28),
      extra = b.readUInt16LE(at + 30),
      comment = b.readUInt16LE(at + 32);
    const name = b.toString("utf8", at + 46, at + 46 + nameLength);
    addEntry(meta, name.replace(/\/$/, ""), name.endsWith("/"), size);
    at += 46 + nameLength + extra + comment;
  }
}

// A ustar or old tar: 512-byte headers, each followed by its data rounded up to 512.
function listTar(b, meta) {
  for (let at = 0; at + 512 <= b.length; ) {
    const header = b.subarray(at, at + 512);
    if (header.every((byte) => byte === 0)) break;
    const field = (start, length) => header.toString("utf8", start, start + length).replace(/\0.*$/s, "");
    const size = parseInt(field(124, 12).trim() || "0", 8);
    const type = String.fromCharCode(header[156] || 48);
    const prefix = field(257, 6).startsWith("ustar") ? field(345, 155) : "";
    const name = (prefix ? `${prefix}/` : "") + field(0, 100);
    // Long-name and pax headers describe the next member rather than being one.
    if (!"xgLK".includes(type)) addEntry(meta, name.replace(/\/$/, ""), type === "5" || name.endsWith("/"), size);
    at += 512 + Math.ceil(size / 512) * 512;
  }
}

function listArchive(path, name, meta) {
  const lower = name.toLowerCase();
  try {
    const st = statSync(path);
    if (!st.isFile()) throw new Error("not a file");
    const whole = head(path, lower.endsWith(".zip") || lower.endsWith(".tar") ? st.size : TGZ_LIMIT + 1);
    if (!whole) throw new Error("unreadable");
    if (lower.endsWith(".zip")) listZip(whole.bytes, meta);
    else if (lower.endsWith(".tar")) listTar(whole.bytes, meta);
    else if (lower.endsWith(".tar.gz") || lower.endsWith(".tgz")) {
      if (whole.size > TGZ_LIMIT) throw new Error("too large");
      listTar(gunzipSync(whole.bytes), meta);
    } else throw new Error("format not read here");
  } catch {
    // A failed read carries nothing, so a partial count never reads as a total.
    Object.assign(meta, { entries: 0, unpacked: 0, names: [], afailed: true });
  }
}

/** The facts for row `row` of `listing`, or null for a row the listing no longer holds. */
export function meta(listing, request) {
  const row = listing?.rows[request.row];
  if (!row) return null;
  const path = join(listing.path, row.name),
    out = blank();
  try {
    if (lstatSync(path).isSymbolicLink()) {
      out.target = readlinkSync(path);
      try {
        out.targetdir = statSync(path).isDirectory();
      } catch {}
    }
  } catch {}
  const file = head(path, 65536);
  const size = file && imageSize(file.bytes);
  if (size) [out.w, out.h] = size;
  if (request.text) countLines(path, out);
  if (request.archive) listArchive(path, row.name, out);
  return { t: "meta", row: request.row, ...out, token: request.token ?? 0 };
}
