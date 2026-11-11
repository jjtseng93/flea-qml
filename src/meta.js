// The `meta` line: the facts one row's preview asks for and a listing row does not carry
// (docs/protocol.md "meta"). Everything here is read by this process from the file itself; no tool
// is run. Upstream: src/backend/meta.rs, metareq.rs, archivelist.rs.
// Not read yet: media duration and rate, EXIF orientation and camera facts, RAW previews, owners.
import { closeSync, fstatSync, lstatSync, openSync, readSync, readlinkSync, statSync, constants } from "node:fs";
import { join } from "node:path";
import { listArchive } from "./archive.js";
import { officeKind, officePreview } from "./office.js";

// A line count stops here and says it is a floor (`partial`).
const LINE_BUDGET = 1 << 20;
// A tile lists this many archive names and states the rest as "+ N more".
const ARCHIVE_NAME_CAP = 64;

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
  // An office document counts the lines its preview shows, not the newlines in its zip.
  if (officeKind(path)) {
    try {
      const text = officePreview(path).text;
      for (let at = text.indexOf("\n"); at !== -1; at = text.indexOf("\n", at + 1)) meta.lines++;
    } catch {
      meta.lfailed = true;
    }
    return;
  }
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

// Every member through src/archive.js, which reads a zip's directory and a tar's headers only.
async function listMembers(path, name, meta) {
  try {
    await listArchive(path, name, (member) => addEntry(meta, member.name, member.dir, member.size));
  } catch {
    // A failed read carries nothing, so a partial count never reads as a total.
    Object.assign(meta, { entries: 0, unpacked: 0, names: [], afailed: true });
  }
}

/** The facts for row `row` of `listing`, or null for a row the listing no longer holds. Async,
 * because a compressed tar's listing streams. */
export async function meta(listing, request) {
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
  if (request.archive) await listMembers(path, row.name, out);
  return { t: "meta", row: request.row, ...out, token: request.token ?? 0 };
}
