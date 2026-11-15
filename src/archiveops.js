// Compress and Extract: `formats` and `archive` (docs/protocol.md "Undocumented requests").
// Upstream: src/backend/archive*.rs, which runs bsdtar and 7z. This port runs no program: zip,
// tar, tar.gz and tar.zst are written and read here, with node:zlib for deflate, gzip and zstd.
//
// Both directions work in a hidden staging name beside the result and publish it under the first
// free name ("pack.zip", then "pack copy.zip", "pack copy 2.zip"), so a failed or cancelled run
// leaves nothing half-written under a real name. Extraction never writes through a link the
// archive made, never leaves the staging folder (absolute and ".." names are refused), and
// copies a tar hard-link member's bytes instead of linking.
//
// Not yet: passwords (7z), .7z/.rar/.xz/.bz2 and packages, the free-space check before an
// extract, a progress bar with bytes, per-drive queueing, and undo.
import { constants, createWriteStream, lstatSync, promises as fsp, statSync } from "node:fs";
import { basename, dirname, join, isAbsolute, resolve, sep } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { crc32, createDeflateRaw, createGunzip, createGzip, createInflateRaw, createZstdCompress, createZstdDecompress } from "node:zlib";
import { BLOCK, MAX_RECORD, listArchive, topLevelArchiveName, checkedSize, checksumMatches, fileReader, octal, paxRecords, scanZip, text } from "./archive.js";
import { capturedPaths } from "./menu.js";
import { copyName, nextJobId, reason } from "./transfer.js";

/** What Compress offers, in menu order. */
export const FORMATS = ["zip", "tar", "tar.gz", "tar.zst"];
const NAME_TRIES = 1000,
  CHUNK = 1 << 20;

const slash = (path) => (process.platform === "win32" ? path.replaceAll("\\", "/") : path);
const lstatOrNull = (path) => {
  try {
    return lstatSync(path);
  } catch {
    return null;
  }
};
class Cancelled extends Error {}

// A transform's output as an async iterable, with a failure on either side thrown to the reader;
// `.pipe` alone would leave the reader waiting forever when the source fails.
function through(source, transform) {
  const pump = pipeline(source, transform);
  pump.catch(() => {});
  return (async function* () {
    for await (const chunk of transform) yield chunk;
    await pump;
  })();
}

// Archive extensions this port reads, longest first; null for one it does not.
const readKind = (lower) =>
  lower.endsWith(".zip") ? "zip"
    : lower.endsWith(".tar") ? "tar"
    : /\.(tar\.gz|tgz)$/.test(lower) ? "tgz"
    : /\.(tar\.zst|tzst)$/.test(lower) ? "tzst"
    : null;

export function formats(request, send) {
  // `archive` is tar's class and `zip` the zip class; `sevenZip` stays false, so .7z and packages
  // never offer Extract, and no format offers a password.
  send({ t: "formats", id: request.id ?? 0, archive: FORMATS, convert: false,
    extract: { archive: true, sevenZip: false, zip: true }, providers: {} });
}

// ---- jobs ----

const jobs = new Map();
/** Cancels a running archive job; false when the id names none. */
export function archiveCancel(id) {
  const job = jobs.get(id);
  if (!job) return false;
  job.cancelled = true;
  return true;
}
const check = (job) => {
  if (job.cancelled) throw new Cancelled("cancelled");
};

// The first free name for `dest`: an archive keeps its format's tail after " copy N", a folder its whole name.
export function freeName(dest, format, n) {
  if (n === 0) return dest;
  const name = basename(dest),
    suffix = n === 1 ? " copy" : ` copy ${n}`;
  if (format === null) return join(dirname(dest), name + suffix);
  const tail = `.${format}`;
  if (name.length > tail.length && name.endsWith(tail)) return join(dirname(dest), name.slice(0, -tail.length) + suffix + tail);
  return join(dirname(dest), copyName(name, n));
}

// rename(2) replaces a file and, for an empty folder, a folder, so each name is checked first; the
// window between check and rename is the one place another program could slip in.
async function publish(staged, dest, format) {
  for (let n = 0; n <= NAME_TRIES; n++) {
    const target = freeName(dest, format, n);
    if (lstatOrNull(target)) continue;
    await fsp.rename(staged, target);
    return target;
  }
  throw Error(`every copy name for this ${format === null ? "folder" : "archive"} is already taken`);
}

const stagingName = (dest, kind, id) => join(dirname(dest), `.flea-work-${kind}-${process.pid}-${id}`);

export function archive(request, send) {
  const id = nextJobId();
  const refuse = (err, extra = {}) => send({ t: "archivedone", id, ok: false, verified: true, err, ...extra });
  if (typeof request.password === "string" && request.password !== "")
    return refuse("only an archive that 7-Zip reads can take a password");
  if (request.op === "compress") return compress(request, send, id, refuse);
  if (request.op === "extract") return extract(request, send, id, refuse);
  refuse(`no archive operation is named ${request.op}`);
}

// ---- compress ----

function compress(request, send, id, refuse) {
  const format = request.format,
    dest = request.dest;
  if (!FORMATS.includes(format)) return refuse(`flea-qml cannot write .${format} archives`);
  if (typeof dest !== "string" || !isAbsolute(dest)) return refuse("the archive needs an absolute destination");
  const paths = request.menuId ? capturedPaths(request.menuId) : request.paths;
  if (!paths) return refuse("Selected items changed; reopen the menu.");
  if (!Array.isArray(paths) || paths.length === 0) return refuse("nothing was selected to compress");
  const parent = dirname(resolve(String(paths[0])));
  for (const path of paths) {
    if (typeof path !== "string" || !isAbsolute(path)) return refuse("every item needs an absolute path");
    if (dirname(resolve(path)) !== parent) return refuse("every item must be in the same folder");
    if (!lstatOrNull(path)) return refuse(`${basename(path)} no longer exists`);
  }
  const job = { cancelled: false };
  jobs.set(id, job);
  send({ t: "archivestarted", id });
  const staged = stagingName(dest, "zip", id);
  (async () => {
    const entries = walkAll(paths.map((path) => resolve(path)), staged, job);
    const body = format === "zip" ? zipStream(entries, job) : tarStream(entries, job);
    const squeeze = format === "tar.gz" ? [createGzip()] : format === "tar.zst" ? [createZstdCompress()] : [];
    await pipeline(Readable.from(body), ...squeeze, createWriteStream(staged, { flags: "wx", mode: 0o644 }));
    check(job);
    const written = await publish(staged, dest, format);
    send({ t: "archivedone", id, ok: true, verified: true, err: "", path: slash(written) });
  })()
    .catch(async (e) => {
      await fsp.rm(staged, { force: true }).catch(() => {});
      send({ t: "archivedone", id, ok: false, verified: true, err: e instanceof Cancelled ? "cancelled" : e?.sentence ?? reason(e) });
    })
    .finally(() => {
      jobs.delete(id);
      send({ t: "changed", path: slash(dirname(dest)) });
    });
}

// Every item and what is under it, parents first, names in code-point order; a link is stored as a
// link, and fifos, sockets and devices are left out. `rel` uses "/" on every system.
async function* walkAll(paths, skip, job) {
  for (const path of paths) yield* walk(path, basename(path), skip, job);
}
async function* walk(abs, rel, skip, job) {
  check(job);
  if (abs === skip) return;
  const st = await fsp.lstat(abs);
  if (st.isSymbolicLink()) return yield { rel, st, kind: "link", link: await fsp.readlink(abs) };
  if (st.isFile()) return yield { rel, st, kind: "file", abs };
  if (!st.isDirectory()) return;
  yield { rel, st, kind: "dir" };
  const names = (await fsp.readdir(abs)).sort();
  for (const name of names) yield* walk(join(abs, name), `${rel}/${name}`, skip, job);
}

// A file's bytes in chunks, read through one handle, checked for a cancel between chunks.
async function* fileBytes(abs, job, size) {
  const handle = await fsp.open(abs, "r");
  try {
    let left = size;
    while (left > 0) {
      check(job);
      const buffer = Buffer.allocUnsafe(Math.min(CHUNK, left));
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, null);
      if (!bytesRead) break;
      left -= bytesRead;
      yield buffer.subarray(0, bytesRead);
    }
    // A file that shrank since its stat is padded, so the header's size stays true.
    if (left > 0) throw Object.assign(Error(`${basename(abs)} changed while it was being compressed`), { sentence: `${basename(abs)} changed while it was being compressed` });
  } finally {
    await handle.close();
  }
}

// ---- tar writer (POSIX ustar, with pax records for what ustar cannot hold) ----

const MAX_OCTAL_11 = 0o77777777777;
function field(block, offset, length, value) {
  Buffer.from(value).copy(block, offset, 0, length);
}
function octalField(block, offset, length, value) {
  const digits = Math.max(0, Math.min(value, 8 ** (length - 1) - 1)).toString(8).padStart(length - 1, "0");
  field(block, offset, length, `${digits}\0`);
}
function paxRecord(key, value) {
  const rest = Buffer.byteLength(` ${key}=${value}\n`);
  let n = rest + 1;
  while (String(n).length + rest !== n) n = String(n).length + rest;
  return `${n} ${key}=${value}\n`;
}
function header({ name, prefix = "", mode, uid, gid, size, mtime, type, link = "" }) {
  const block = Buffer.alloc(BLOCK);
  field(block, 0, 100, name);
  octalField(block, 100, 8, mode);
  octalField(block, 108, 8, uid);
  octalField(block, 116, 8, gid);
  octalField(block, 124, 12, size);
  octalField(block, 136, 12, mtime);
  block.fill(0x20, 148, 156);
  block[156] = type.charCodeAt(0);
  field(block, 157, 100, link);
  field(block, 257, 6, "ustar\0");
  field(block, 263, 2, "00");
  field(block, 345, 155, prefix);
  let sum = 0;
  for (const byte of block) sum += byte;
  field(block, 148, 8, `${sum.toString(8).padStart(6, "0")}\0 `);
  return block;
}
const padding = (size) => Buffer.alloc((BLOCK - (size % BLOCK)) % BLOCK);

// ustar's name splits once at a "/" into a 155-byte prefix and a 100-byte name; a name that fits
// neither way, a long link and a size past 8 GiB go in a pax record ahead of the header.
function tarHeaders(entry) {
  const name = entry.kind === "dir" ? `${entry.rel}/` : entry.rel,
    bytes = Buffer.from(name),
    size = entry.kind === "file" ? entry.st.size : 0,
    pax = [];
  let short = name,
    prefix = "";
  if (bytes.length > 100) {
    let split = -1;
    for (let i = bytes.length - 1; i > 0; i--)
      if (bytes[i] === 0x2f && i <= 155 && bytes.length - i - 1 <= 100 && bytes.length - i - 1 > 0) {
        split = i;
        break;
      }
    if (split > 0) {
      prefix = bytes.subarray(0, split).toString();
      short = bytes.subarray(split + 1).toString();
    } else {
      pax.push(paxRecord("path", name));
      short = bytes.subarray(0, 100).toString("latin1");
    }
  }
  const link = entry.link ?? "";
  if (Buffer.byteLength(link) > 100) pax.push(paxRecord("linkpath", link));
  if (size > MAX_OCTAL_11) pax.push(paxRecord("size", String(size)));
  const mtime = Math.max(0, Math.floor(entry.st.mtimeMs / 1000));
  const out = [];
  if (pax.length) {
    const data = Buffer.from(pax.join(""));
    if (data.length > MAX_RECORD) throw Error(`${entry.rel} has a name too long to store`);
    out.push(header({ name: `PaxHeader/${basename(entry.rel)}`.slice(0, 99), mode: 0o644, uid: 0, gid: 0, size: data.length, mtime, type: "x" }), data, padding(data.length));
  }
  out.push(header({ name: short, prefix, mode: entry.st.mode & 0o7777, uid: entry.st.uid, gid: entry.st.gid, size, mtime,
    type: entry.kind === "dir" ? "5" : entry.kind === "link" ? "2" : "0", link: Buffer.byteLength(link) > 100 ? "" : link }));
  return out;
}

async function* tarStream(entries, job) {
  for await (const entry of entries) {
    yield* tarHeaders(entry);
    if (entry.kind !== "file") continue;
    yield* fileBytes(entry.abs, job, entry.st.size);
    yield padding(entry.st.size);
  }
  yield Buffer.alloc(BLOCK * 2);
}

// ---- zip writer (deflate, UTF-8 names, data descriptors, zip64 past 4 GiB or 65535 entries) ----

const U32 = 0xffffffff;
function dosStamp(ms) {
  const date = new Date(ms);
  if (date.getFullYear() < 1980) return { time: 0, date: (1 << 5) | 1 };
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1),
    date: ((Math.min(date.getFullYear(), 2107) - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

// The "UT" extra field: the modification time in whole Unix seconds, which a DOS stamp rounds to two.
function timeExtra(ms) {
  const extra = Buffer.alloc(9);
  extra.writeUInt16LE(0x5455, 0);
  extra.writeUInt16LE(5, 2);
  extra[4] = 1;
  extra.writeInt32LE(Math.max(-0x80000000, Math.min(0x7fffffff, Math.floor(ms / 1000))), 5);
  return extra;
}

async function* zipStream(entries, job) {
  const central = [];
  let offset = 0;
  const emit = (buffer) => {
    offset += buffer.length;
    return buffer;
  };
  for await (const entry of entries) {
    const name = Buffer.from(entry.kind === "dir" ? `${entry.rel}/` : entry.rel),
      stamp = dosStamp(entry.st.mtimeMs),
      deflated = entry.kind === "file",
      big = deflated && entry.st.size >= 0xffff0000,
      start = offset;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(big ? 45 : 20, 4);
    local.writeUInt16LE(0x0808, 6); // data descriptor, UTF-8 name
    local.writeUInt16LE(deflated ? 8 : 0, 8);
    local.writeUInt16LE(stamp.time, 10);
    local.writeUInt16LE(stamp.date, 12);
    if (big) {
      local.writeUInt32LE(U32, 18);
      local.writeUInt32LE(U32, 22);
    }
    local.writeUInt16LE(name.length, 26);
    const localExtra = Buffer.concat([timeExtra(entry.st.mtimeMs), ...(big ? [Buffer.from([1, 0, 16, 0]), Buffer.alloc(16)] : [])]);
    local.writeUInt16LE(localExtra.length, 28);
    yield emit(Buffer.concat([local, name, localExtra]));
    let crc = 0,
      size = 0,
      packed = 0;
    if (entry.kind === "link") {
      const data = Buffer.from(entry.link);
      crc = crc32(data);
      size = packed = data.length;
      yield emit(data);
    } else if (deflated) {
      const source = Readable.from((async function* () {
        for await (const chunk of fileBytes(entry.abs, job, entry.st.size)) {
          crc = crc32(chunk, crc);
          size += chunk.length;
          yield chunk;
        }
      })());
      for await (const chunk of through(source, createDeflateRaw())) {
        check(job);
        packed += chunk.length;
        yield emit(chunk);
      }
    }
    const descriptor = Buffer.alloc(big ? 24 : 16);
    descriptor.writeUInt32LE(0x08074b50, 0);
    descriptor.writeUInt32LE(crc >>> 0, 4);
    if (big) {
      descriptor.writeBigUInt64LE(BigInt(packed), 8);
      descriptor.writeBigUInt64LE(BigInt(size), 16);
    } else {
      descriptor.writeUInt32LE(packed, 8);
      descriptor.writeUInt32LE(size, 12);
    }
    yield emit(descriptor);
    const unixType = entry.kind === "dir" ? 0o040000 : entry.kind === "link" ? 0o120000 : 0o100000;
    central.push({ name, stamp, mtimeMs: entry.st.mtimeMs, method: deflated ? 8 : 0, crc: crc >>> 0, size, packed, start, big,
      external: (((unixType | (entry.st.mode & 0o7777)) << 16) | (entry.kind === "dir" ? 0x10 : 0)) >>> 0 });
  }
  const directoryStart = offset;
  for (const item of central) {
    const wide = [];
    if (item.size >= U32) wide.push(item.size);
    if (item.packed >= U32) wide.push(item.packed);
    if (item.start >= U32) wide.push(item.start);
    const field = Buffer.alloc(wide.length ? 4 + 8 * wide.length : 0);
    if (wide.length) {
      field.writeUInt16LE(1, 0);
      field.writeUInt16LE(8 * wide.length, 2);
      wide.forEach((value, i) => field.writeBigUInt64LE(BigInt(value), 4 + 8 * i));
    }
    const extra = Buffer.concat([timeExtra(item.mtimeMs), field]);
    const record = Buffer.alloc(46);
    record.writeUInt32LE(0x02014b50, 0);
    record.writeUInt16LE((3 << 8) | 63, 4); // made by Unix, so the mode in `external` is read
    record.writeUInt16LE(item.big || wide.length ? 45 : 20, 6);
    record.writeUInt16LE(0x0808, 8);
    record.writeUInt16LE(item.method, 10);
    record.writeUInt16LE(item.stamp.time, 12);
    record.writeUInt16LE(item.stamp.date, 14);
    record.writeUInt32LE(item.crc, 16);
    record.writeUInt32LE(Math.min(item.packed, U32), 20);
    record.writeUInt32LE(Math.min(item.size, U32), 24);
    record.writeUInt16LE(item.name.length, 28);
    record.writeUInt16LE(extra.length, 30);
    record.writeUInt32LE(item.external, 38);
    record.writeUInt32LE(Math.min(item.start, U32), 42);
    yield emit(Buffer.concat([record, item.name, extra]));
  }
  const directorySize = offset - directoryStart,
    count = central.length;
  if (count > 0xffff || directoryStart >= U32 || directorySize >= U32) {
    const zip64 = Buffer.alloc(56),
      at = offset;
    zip64.writeUInt32LE(0x06064b50, 0);
    zip64.writeBigUInt64LE(44n, 4);
    zip64.writeUInt16LE((3 << 8) | 63, 12);
    zip64.writeUInt16LE(45, 14);
    zip64.writeBigUInt64LE(BigInt(count), 24);
    zip64.writeBigUInt64LE(BigInt(count), 32);
    zip64.writeBigUInt64LE(BigInt(directorySize), 40);
    zip64.writeBigUInt64LE(BigInt(directoryStart), 48);
    const locator = Buffer.alloc(20);
    locator.writeUInt32LE(0x07064b50, 0);
    locator.writeBigUInt64LE(BigInt(at), 8);
    locator.writeUInt32LE(1, 16);
    yield emit(Buffer.concat([zip64, locator]));
  }
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Math.min(count, 0xffff), 8);
  end.writeUInt16LE(Math.min(count, 0xffff), 10);
  end.writeUInt32LE(Math.min(directorySize, U32), 12);
  end.writeUInt32LE(Math.min(directoryStart, U32), 16);
  yield emit(end);
}

// ---- extract ----

function extract(request, send, id, refuse) {
  const path = request.path,
    dest = request.dest;
  if (typeof path !== "string" || !isAbsolute(path)) return refuse("the archive needs an absolute path");
  if (typeof dest !== "string" || !isAbsolute(dest)) return refuse("the archive needs an absolute destination");
  const lower = path.toLowerCase();
  if (lower.endsWith(".iso")) return refuse("a disk image opens as a listing and is never extracted");
  const kind = readKind(lower);
  if (!kind) return refuse(`flea-qml cannot extract ${basename(path)} yet; it reads .zip, .tar, .tar.gz and .tar.zst`);
  let st;
  try {
    st = statSync(path);
  } catch (e) {
    return refuse(reason(e));
  }
  if (!st.isFile()) return refuse(`${basename(path)} is not a file`);
  const job = { cancelled: false };
  jobs.set(id, job);
  send({ t: "archivestarted", id });
  send({ t: "extractstarted", id });
  send({ t: "transferprogress", id, index: 0, name: basename(path), bytes: 0, total: 0, scanned: 0 });
  const here = request.here === true;
  const staged = stagingName(here ? join(dest, "contents") : dest, "ext", id);
  let ownsStaged = false;
  (async () => {
    if (here) {
      if (!lstatOrNull(dest)?.isDirectory()) throw Error("Extract here needs an existing real folder");
      if (request.confirmed !== true) {
        const entries = new Set();
        await listArchive(path, path, member => {
          check(job);
          const root = topLevelArchiveName(member.name);
          if (root) entries.add(root);
          if (entries.size > 5) throw Error("Extract here needs confirmation for more than 5 top-level items");
        });
      }
    }
    await fsp.mkdir(staged, { mode: 0o700 });
    ownsStaged = true;
    const out = new Extractor(staged, job);
    if (kind === "zip") await readZip(path, out, job);
    else await readTar(path, kind, out, job);
    await out.finish();
    check(job);
    let written = dest;
    if (here) {
      // Publish complete top-level items without merging existing folders. Roll back our
      // moves if publishing fails; cancellation is checked before this short commit phase.
      const moved = [];
      try {
        for (const name of await fsp.readdir(staged)) {
          const source = join(staged, name);
          const target = await publish(source, join(dest, name), lstatOrNull(source)?.isDirectory() ? null : "");
          moved.push([source, target]);
        }
      } catch (error) {
        for (const [source, target] of moved.reverse()) await fsp.rename(target, source);
        throw error;
      }
      await fsp.rmdir(staged);
    } else written = await publish(staged, dest, null);
    send({ t: "archivedone", id, ok: true, verified: true, err: "", path: slash(path), dest: slash(written) });
  })()
    .catch(async (e) => {
      if (ownsStaged) await fsp.rm(staged, { recursive: true, force: true }).catch(() => {});
      send({ t: "archivedone", id, ok: false, verified: true, path: slash(path), dest: slash(dest),
        err: e instanceof Cancelled ? "cancelled" : e?.sentence ?? reason(e) });
    })
    .finally(() => {
      jobs.delete(id);
      send({ t: "changed", path: slash(here ? dest : dirname(dest)) });
    });
}

const refusal = (sentence) => Object.assign(Error(sentence), { sentence });

// Writes members under one root. A member's parents are made as real folders; a member whose path
// runs through a link, or names an absolute path or "..", is refused, so nothing lands outside.
class Extractor {
  constructor(root, job) {
    this.root = root;
    this.job = job;
    this.folders = [];
  }
  parts(name) {
    const text = String(name).replaceAll("\\", "/");
    if (text.startsWith("/") || /^[A-Za-z]:/.test(text)) throw refusal(`the archive names an absolute path, ${name}, so nothing was extracted`);
    const parts = text.split("/").filter((part) => part !== "" && part !== ".");
    if (parts.includes("..")) throw refusal(`the archive names a path outside its folder, ${name}, so nothing was extracted`);
    return parts;
  }
  async parents(parts) {
    let at = this.root;
    for (const part of parts.slice(0, -1)) {
      at = join(at, part);
      const st = lstatOrNull(at);
      if (!st) await fsp.mkdir(at, { mode: 0o755 });
      else if (!st.isDirectory()) throw refusal(`the archive writes through ${parts.join("/")}, which is not a folder, so nothing was extracted`);
    }
    return join(this.root, ...parts);
  }
  // A later member of the same name replaces an earlier one, as tar does; a folder is never replaced.
  async clear(path) {
    const st = lstatOrNull(path);
    if (!st) return;
    if (st.isDirectory()) throw refusal(`the archive holds a file and a folder both named ${basename(path)}`);
    await fsp.unlink(path);
  }
  async folder(name, mode, mtime) {
    const parts = this.parts(name);
    if (!parts.length) return;
    const path = await this.parents(parts),
      st = lstatOrNull(path);
    if (st && !st.isDirectory()) await fsp.unlink(path);
    if (!st || !st.isDirectory()) await fsp.mkdir(path, { mode: 0o755 });
    this.folders.push({ path, mode, mtime });
  }
  async file(name, mode, mtime, chunks) {
    const parts = this.parts(name);
    if (!parts.length) {
      for await (const _ of chunks);
      return;
    }
    const path = await this.parents(parts);
    await this.clear(path);
    const handle = await fsp.open(path, "wx", (mode & 0o777) || 0o644);
    try {
      for await (const chunk of chunks) {
        check(this.job);
        let written = 0;
        while (written < chunk.length) written += (await handle.write(chunk, written, chunk.length - written)).bytesWritten;
      }
    } finally {
      await handle.close();
    }
    if (mtime) await fsp.utimes(path, mtime, mtime).catch(() => {});
  }
  async link(name, target) {
    const parts = this.parts(name);
    if (!parts.length) return;
    const path = await this.parents(parts);
    await this.clear(path);
    await fsp.symlink(target, path);
  }
  // A hard-link member names an earlier member; its bytes are copied, never linked.
  async copyOf(name, earlier, mode, mtime) {
    const parts = this.parts(name),
      from = join(this.root, ...this.parts(earlier));
    const st = lstatOrNull(from);
    if (!st?.isFile()) throw refusal(`${name} links to ${earlier}, which the archive does not hold before it`);
    const path = await this.parents(parts);
    await this.clear(path);
    await fsp.copyFile(from, path, constants.COPYFILE_EXCL);
    await fsp.chmod(path, ((mode & 0o777) || st.mode & 0o777) & ~process.umask()).catch(() => {});
    if (mtime) await fsp.utimes(path, mtime, mtime).catch(() => {});
  }
  // Folder modes and times last and deepest first: a read-only folder would refuse its own members.
  async finish() {
    for (const { path, mode, mtime } of this.folders.reverse()) {
      // chmod skips the umask an open applies, so it is applied here, as bsdtar does for anyone but root.
      if (mode) await fsp.chmod(path, mode & 0o777 & ~process.umask()).catch(() => {});
      if (mtime) await fsp.utimes(path, mtime, mtime).catch(() => {});
    }
  }
}

// The bytes of an async iterable read as exactly-sized pieces.
class Bytes {
  constructor(iterable) {
    this.it = iterable[Symbol.asyncIterator]();
    this.buffer = Buffer.alloc(0);
  }
  async more() {
    const { value, done } = await this.it.next();
    if (done) return false;
    this.buffer = this.buffer.length ? Buffer.concat([this.buffer, value]) : value;
    return true;
  }
  async read(n) {
    while (this.buffer.length < n) if (!(await this.more())) break;
    const out = this.buffer.subarray(0, n);
    this.buffer = this.buffer.subarray(out.length);
    return out;
  }
  async *take(n) {
    while (n > 0) {
      if (!this.buffer.length && !(await this.more())) throw refusal("the archive is truncated");
      const out = this.buffer.subarray(0, Math.min(n, this.buffer.length));
      this.buffer = this.buffer.subarray(out.length);
      n -= out.length;
      yield out;
    }
  }
  async skip(n) {
    for await (const _ of this.take(n));
  }
}

async function* handleChunks(handle, start, length) {
  for (let done = 0; done < length; ) {
    const buffer = Buffer.allocUnsafe(Math.min(CHUNK, length - done));
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, start + done);
    if (!bytesRead) throw refusal("the archive is truncated");
    done += bytesRead;
    yield buffer.subarray(0, bytesRead);
  }
}

async function readTar(path, kind, out, job) {
  const handle = await fsp.open(path, "r");
  try {
    const { size } = await handle.stat();
    const raw = Readable.from(handleChunks(handle, 0, size));
    const bytes = new Bytes(kind === "tgz" ? through(raw, createGunzip()) : kind === "tzst" ? through(raw, createZstdDecompress()) : raw);
    let longName = null,
      longLink = null,
      extended = {},
      global = {};
    for (;;) {
      check(job);
      const block = await bytes.read(BLOCK);
      if (block.length < BLOCK) break;
      if (block.every((byte) => byte === 0)) continue;
      if (!checksumMatches(block)) throw refusal("the archive is damaged: a tar header is invalid");
      const flag = String.fromCharCode(block[156] || 0x30),
        attrs = { ...global, ...extended },
        metadata = ["L", "K", "x", "X", "g"].includes(flag),
        size = checkedSize(!metadata && attrs.size !== undefined ? Number(attrs.size) : octal(block, 124, 12)),
        pad = (BLOCK - (size % BLOCK)) % BLOCK;
      if (metadata) {
        if (size > MAX_RECORD) throw refusal("the archive is damaged: a tar record is too large");
        const data = Buffer.concat(await Array.fromAsync(bytes.take(size)));
        await bytes.skip(pad);
        if (flag === "L") longName = data.toString().replace(/\0+$/, "");
        else if (flag === "K") longLink = data.toString().replace(/\0+$/, "");
        else if (flag === "g") global = { ...global, ...paxRecords(data) };
        else extended = { ...extended, ...paxRecords(data) };
        continue;
      }
      const prefix = text(block, 257, 5) === "ustar" ? text(block, 345, 155) : "",
        stored = text(block, 0, 100),
        name = attrs.path ?? longName ?? (prefix ? `${prefix}/${stored}` : stored),
        link = attrs.linkpath ?? longLink ?? text(block, 157, 100),
        mode = octal(block, 100, 8),
        mtime = attrs.mtime !== undefined ? Number(attrs.mtime) : octal(block, 136, 12);
      longName = longLink = null;
      extended = {};
      if (flag === "0" || flag === "\0" || flag === "7") {
        if (name.endsWith("/")) await out.folder(name, mode, mtime);
        else await out.file(name, mode, mtime, bytes.take(size));
      } else if (flag === "5") await out.folder(name, mode, mtime);
      else if (flag === "2") await out.link(name, link);
      else if (flag === "1") await out.copyOf(name, link, mode, mtime);
      // Devices, fifos and anything newer carry nothing a folder of files can hold.
      await bytes.skip(flag === "0" || flag === "\0" || flag === "7" ? (name.endsWith("/") ? size : 0) : size);
      await bytes.skip(pad);
    }
  } finally {
    await handle.close();
  }
}

// Info-ZIP's DOS stamp in local time, as unzip reads it.
const dosDate = (time, date) => new Date(((date >> 9) & 0x7f) + 1980, ((date >> 5) & 15) - 1, date & 31, time >> 11, (time >> 5) & 63, (time & 31) * 2);

async function readZip(path, out, job) {
  const handle = await fsp.open(path, "r");
  try {
    const { size } = await handle.stat();
    const members = [];
    scanZip(fileReader(handle.fd, size), (entry, raw) => members.push({ ...entry, ...raw }));
    for (const member of members) {
      check(job);
      if (member.encrypted) throw refusal("this archive is encrypted, and flea-qml cannot extract with a password yet");
      const unixMode = member.madeBy === 3 ? member.external >>> 16 : 0,
        type = unixMode & 0o170000,
        mtime = member.mtime !== undefined ? member.mtime : dosDate(member.time, member.date);
      if (member.dir || type === 0o040000) {
        await out.folder(member.name, unixMode & 0o7777 || 0o755, mtime);
        continue;
      }
      if (member.method !== 0 && member.method !== 8) throw refusal(`${member.name} uses a compression this port cannot read (method ${member.method})`);
      const local = Buffer.alloc(30);
      await handle.read(local, 0, 30, member.local);
      if (local.readUInt32LE(0) !== 0x04034b50) throw refusal("the archive is damaged: a member header is missing");
      const start = member.local + 30 + local.readUInt16LE(26) + local.readUInt16LE(28);
      let crc = 0;
      const data = (async function* () {
        const stored = Readable.from(handleChunks(handle, start, member.compressed));
        const raw = member.method === 8 ? through(stored, createInflateRaw()) : stored;
        let total = 0;
        for await (const chunk of raw) {
          crc = crc32(chunk, crc);
          total += chunk.length;
          if (total > member.size) throw refusal(`the archive is damaged: ${member.name} is larger than it says`);
          yield chunk;
        }
        if (total !== member.size || crc >>> 0 !== member.crc) throw refusal(`the archive is damaged: ${member.name} does not match its checksum`);
      })();
      if (type === 0o120000) {
        const target = Buffer.concat(await Array.fromAsync(data)).toString();
        await out.link(member.name, target);
      } else await out.file(member.name, unixMode & 0o777 || 0o644, mtime, data);
    }
  } finally {
    await handle.close();
  }
}
