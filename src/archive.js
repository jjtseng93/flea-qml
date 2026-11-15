// Archive listings for the preview: what `tar -tf` and `unzip -l` would print, as
// { name, dir, size } per member. The header and central-directory parsers come from
// buninu-linux's initramfs/bin/tar and initramfs/bin/unzip@da0b394 (MIT, Dr. John), changed to read
// through a descriptor: a zip reads its tail and central directory only, and a plain tar reads
// each header and seeks past the member's data, so neither loads the archive. A compressed tar
// cannot be sought through, so it is inflated as a stream and its member data dropped as it passes.
import { closeSync, constants, fstatSync, openSync, readSync } from "node:fs";
import { Readable } from "node:stream";
import { createGunzip, createZstdDecompress, inflateRawSync } from "node:zlib";

const BLOCK = 512;
const MAX_RECORD = 1024 * 1024;
function checkedSize(value) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error("invalid archive size");
  return value;
}
const decoder = new TextDecoder(),
  strictUtf8 = new TextDecoder("utf-8", { fatal: true });

// Reads at an offset through a descriptor, or from bytes already in memory; short at the end.
function fileReader(fd, size) {
  return {
    size,
    read(position, length) {
      checkedSize(position);
      checkedSize(length);
      if (position > size || length > size - position) throw new Error("truncated archive");
      const n = length,
        buffer = Buffer.alloc(n);
      let done = 0;
      while (done < n) {
        const count = readSync(fd, buffer, done, n - done, position + done);
        if (count === 0) break;
        done += count;
      }
      return done === n ? buffer : buffer.subarray(0, done);
    },
  };
}

// ---- tar (buninu-linux initramfs/bin/tar scanEntries) ----

const text = (block, offset, length) => {
  let end = offset;
  const stop = offset + length;
  while (end < stop && block[end] !== 0) end++;
  return decoder.decode(block.subarray(offset, end));
};

const octal = (block, offset, length) => {
  // GNU base-256 encoding for values that do not fit the octal field.
  if (block[offset] & 0x80) {
    let value = block[offset] & 0x7f;
    for (let index = offset + 1; index < offset + length; index++) value = value * 256 + block[index];
    return value;
  }
  const value = Number.parseInt(text(block, offset, length).trim(), 8);
  return Number.isFinite(value) ? value : 0;
};

// The header checksum is computed with its own field read as spaces. A mismatch means this is
// not a tar header, so the listing fails rather than showing partial totals.
const checksumMatches = (block) => {
  let sum = 0;
  for (let index = 0; index < BLOCK; index++) sum += index >= 148 && index < 156 ? 0x20 : block[index];
  return sum === octal(block, 148, 8);
};

// Each record's length counts bytes, so the records are cut from the bytes and decoded one by one;
// cutting a decoded string by that length breaks on any multi-byte name.
const paxRecords = (data) => {
  const records = Object.create(null);
  let offset = 0;
  while (offset < data.length) {
    const space = data.indexOf(0x20, offset);
    if (space === -1) break;
    const length = Number.parseInt(decoder.decode(data.subarray(offset, space)), 10);
    if (!Number.isFinite(length) || length <= 0 || offset + length > data.length) break;
    const record = decoder.decode(data.subarray(space + 1, offset + length)).replace(/\n$/, "");
    const equals = record.indexOf("=");
    if (equals > 0) records[record.slice(0, equals)] = record.slice(equals + 1);
    offset += length;
  }
  return records;
};

// The header logic both readers share: POSIX ustar, GNU long names (L/K), pax headers (x/X/g), and
// tar streams joined end to end, as APK v2 does. `header` answers how many bytes of the member that
// follows are wanted (a long name or pax record) and how many to skip; `record` takes the wanted ones.
class TarHeaders {
  constructor(visit) {
    this.visit = visit;
    this.longName = null;
    this.extended = {};
    this.global = {};
    this.seen = 0;
    this.done = false;
    this.pending = null;
  }
  // Reject invalid headers even after valid members.
  header(block) {
    if (block.every((byte) => byte === 0)) {
      this.longName = null;
      this.extended = {};
      this.global = {};
      return { want: 0, skip: 0 };
    }
    if (!checksumMatches(block)) {
      throw new Error("invalid tar header");
    }
    this.seen++;
    const flag = String.fromCharCode(block[156] || 0x30);
    const metadata = ["L", "K", "x", "X", "g"].includes(flag);
    const attrs = { ...this.global, ...this.extended };
    const size = checkedSize(!metadata && attrs.size !== undefined ? Number(attrs.size) : octal(block, 124, 12));
    const padded = checkedSize(Math.ceil(size / BLOCK) * BLOCK);
    if (metadata) {
      if (size > MAX_RECORD) throw new Error("tar metadata record is too large");
      this.pending = flag;
      return { want: size, skip: padded - size };
    }
    if (flag !== "g") {
      const prefix = text(block, 257, 5) === "ustar" ? text(block, 345, 155) : "",
        stored = text(block, 0, 100);
      const name = (attrs.path ?? this.longName ?? (prefix ? `${prefix}/${stored}` : stored)).replace(/^\.\//, "");
      if (name) this.visit({ name: name.replace(/\/$/, ""), dir: flag === "5" || name.endsWith("/"), size: flag === "5" ? 0 : size });
      this.longName = null;
      this.extended = {};
    }
    return { want: 0, skip: padded };
  }
  record(data) {
    if (this.pending === "L") this.longName = decoder.decode(data).replace(/\0+$/, "");
    else if (this.pending === "x" || this.pending === "X") this.extended = { ...this.extended, ...paxRecords(data) };
    else if (this.pending === "g") this.global = { ...this.global, ...paxRecords(data) };
    this.pending = null;
  }
}

// A plain tar through its descriptor: one read per header, a seek past every member's data.
function scanTar(reader, visit) {
  const headers = new TarHeaders(visit);
  for (let offset = 0; offset < reader.size; ) {
    const block = reader.read(offset, BLOCK);
    if (block.length < BLOCK) break;
    offset += BLOCK;
    const { want, skip } = headers.header(block);
    if (want + skip > reader.size - offset) throw new Error("truncated tar member");
    if (want || headers.pending) headers.record(reader.read(offset, want));
    offset += want + skip;
  }
}

// A compressed tar, inflated as a stream: headers and their small records are kept, member data is
// counted past and dropped, so memory stays one chunk however large the archive unpacks.
function streamTar(fd, size, inflate, visit) {
  return new Promise((resolve, reject) => {
    const headers = new TarHeaders(visit),
      // Keep ownership of the checked descriptor here. Some Bun versions close an
      // fs.ReadStream's fd on destroy even when autoClose is false.
      input = Readable.from((function* () {
        const reader = fileReader(fd, size);
        for (let offset = 0; offset < size; offset += 65536)
          yield reader.read(offset, Math.min(65536, size - offset));
      })()),
      output = input.pipe(inflate);
    let block = Buffer.alloc(0),
      want = 0,
      wanted = [],
      skip = 0;
    let settled = false;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      input.destroy();
      output.destroy();
      error ? reject(error) : resolve();
    };
    output.on("data", (chunk) => {
      try {
        while (chunk.length && !headers.done) {
          // A record's bytes come first, then the padding to its block, so want before skip.
          if (want) {
            const n = Math.min(want, chunk.length);
            wanted.push(chunk.subarray(0, n));
            want -= n;
            chunk = chunk.subarray(n);
            if (!want) {
              headers.record(Buffer.concat(wanted));
              wanted = [];
            }
          } else if (skip) {
            const n = Math.min(skip, chunk.length);
            skip -= n;
            chunk = chunk.subarray(n);
          } else {
            const n = Math.min(BLOCK - block.length, chunk.length);
            block = Buffer.concat([block, chunk.subarray(0, n)]);
            chunk = chunk.subarray(n);
            if (block.length === BLOCK) {
              ({ want, skip } = headers.header(block));
              if (!want && headers.pending) headers.record(Buffer.alloc(0));
              block = Buffer.alloc(0);
            }
          }
        }
        if (headers.done) finish();
      } catch (error) {
        finish(error);
      }
    });
    output.on("end", () => finish(want || skip || block.length ? new Error("truncated tar stream") : undefined));
    output.on("error", finish);
    input.on("error", finish);
  });
}

// ---- zip (buninu-linux initramfs/bin/unzip) ----

function scanZip(reader, visit) {
  // End of central directory: in the last 64 KiB + 22 bytes, searched backwards.
  const tailLength = Math.min(reader.size, 65557),
    tail = reader.read(reader.size - tailLength, tailLength);
  let eocd = -1;
  for (let offset = tailLength - 22; offset >= 0; offset--)
    if (tail.readUInt32LE(offset) === 0x06054b50 && offset + 22 + tail.readUInt16LE(offset + 20) === tail.length) {
      eocd = offset;
      break;
    }
  if (eocd < 0) throw new Error("not a zip archive");
  // The bounds below follow buninu-linux's initramfs/bin/unzip: one disk only, and every range
  // inside the space before the record that names it.
  if (tail.readUInt16LE(eocd + 4) !== 0 || tail.readUInt16LE(eocd + 6) !== 0 || tail.readUInt16LE(eocd + 8) !== tail.readUInt16LE(eocd + 10))
    throw new Error("split archives are not supported");
  const uint64 = (buffer, offset) => checkedSize(Number(buffer.readBigUInt64LE(offset)));
  let entryCount = tail.readUInt16LE(eocd + 10),
    directorySize = tail.readUInt32LE(eocd + 12),
    directoryOffset = tail.readUInt32LE(eocd + 16),
    directoryLimit = reader.size - tailLength + eocd;
  // zip64: the locator sits just before the end of central directory record.
  if (eocd >= 20 && tail.readUInt32LE(eocd - 20) === 0x07064b50) {
    if (tail.readUInt32LE(eocd - 16) !== 0 || tail.readUInt32LE(eocd - 4) !== 1) throw new Error("split zip64 archives are not supported");
    const recordOffset = uint64(tail, eocd - 20 + 8);
    if (recordOffset > directoryLimit - 20 - 56) throw new Error("bad zip64 record range");
    const record = reader.read(recordOffset, 56);
    if (record.length < 56 || record.readUInt32LE(0) !== 0x06064b50) throw new Error("bad zip64 end of central directory");
    if (record.readUInt32LE(16) !== 0 || record.readUInt32LE(20) !== 0 || uint64(record, 24) !== uint64(record, 32) || uint64(record, 4) < 44)
      throw new Error("bad or split zip64 directory");
    directoryLimit = recordOffset;
    entryCount = uint64(record, 32);
    directorySize = uint64(record, 40);
    directoryOffset = uint64(record, 48);
  }
  checkedSize(entryCount);
  checkedSize(directoryOffset);
  checkedSize(directorySize);
  if (directoryOffset > directoryLimit || directorySize > directoryLimit - directoryOffset || entryCount > Math.floor(directorySize / 46))
    throw new Error("bad central directory bounds");
  let positionInDirectory = 0;
  for (let index = 0; index < entryCount; index++) {
    if (directorySize - positionInDirectory < 46) throw new Error("truncated central directory");
    const header = reader.read(directoryOffset + positionInDirectory, 46);
    const length = 46 + header.readUInt16LE(28) + header.readUInt16LE(30) + header.readUInt16LE(32);
    if (length > directorySize - positionInDirectory) throw new Error("truncated central entry");
    const central = reader.read(directoryOffset + positionInDirectory, length), offset = 0;
    if (central.readUInt32LE(0) !== 0x02014b50) throw new Error("bad central directory");
    if (central.readUInt16LE(34) !== 0) throw new Error("split members are not supported");
    const flags = central.readUInt16LE(offset + 8),
      nameLength = central.readUInt16LE(offset + 28),
      extraLength = central.readUInt16LE(offset + 30),
      commentLength = central.readUInt16LE(offset + 32);
    let size = central.readUInt32LE(offset + 24),
      compressed = central.readUInt32LE(offset + 20),
      local = central.readUInt32LE(offset + 42),
      mtime;
    const wide = [size, compressed, local].filter((value) => value === 0xffffffff).length;
    let foundWide = false;
    // Info-ZIP writes UTF-8 names without the 0x800 flag, so a name that decodes as UTF-8 is read
    // as UTF-8 and only the rest as the old code page's stand-in, latin1.
    const raw = central.subarray(offset + 46, offset + 46 + nameLength);
    let name;
    try {
      name = flags & 0x800 ? raw.toString("utf8") : strictUtf8.decode(raw);
    } catch {
      name = raw.toString("latin1");
    }
    // zip64 extra field: the 0xFFFFFFFF fields follow, uncompressed size first.
    const extra = central.subarray(offset + 46 + nameLength, offset + 46 + nameLength + extraLength);
    for (let position = 0; position + 4 <= extra.length; ) {
      const id = extra.readUInt16LE(position),
        length = extra.readUInt16LE(position + 2);
      if (length > extra.length - position - 4) throw new Error("truncated zip extra field");
      // "UT": the modification time in whole Unix seconds, which the DOS stamp rounds to two.
      if (id === 0x5455 && length >= 5 && extra[position + 4] & 1) mtime = extra.readInt32LE(position + 5);
      if (id === 0x0001 && !foundWide) {
        foundWide = true;
        // Only the fields that overflowed are present, in this order.
        let at = position + 4;
        const end = position + 4 + length;
        const next = () => {
          if (end - at < 8) throw new Error("truncated zip64 size");
          const value = checkedSize(Number(extra.readBigUInt64LE(at)));
          at += 8;
          return value;
        };
        if (size === 0xffffffff) size = next();
        if (compressed === 0xffffffff) compressed = next();
        if (local === 0xffffffff) local = next();
      }
      position += 4 + length;
    }
    if (wide && !foundWide) throw new Error("missing zip64 extra field");
    if (local > directoryOffset || directoryOffset - local < 30 || compressed > directoryOffset - local - 30)
      throw new Error("bad zip member range");
    // The second argument is what reading the member's bytes needs (openZip); a listing ignores it.
    visit({ name: name.replace(/\/$/, ""), dir: name.endsWith("/"), size },
      { method: central.readUInt16LE(offset + 10), encrypted: (flags & 1) === 1, compressed, local,
        crc: central.readUInt32LE(offset + 16), madeBy: central.readUInt16LE(offset + 4) >> 8,
        external: central.readUInt32LE(offset + 38), time: central.readUInt16LE(offset + 12), date: central.readUInt16LE(offset + 14), mtime });
    positionInDirectory += length;
  }
}

// ---- the listing ----

const kindOf = (lower) =>
  lower.endsWith(".zip")
    ? "zip"
    : lower.endsWith(".tar")
      ? "tar"
      : /\.(tar\.gz|tgz)$/.test(lower)
        ? "tgz"
        : /\.(tar\.zst|tzst)$/.test(lower)
          ? "tzst"
          : "";

export const listable = (name) => kindOf(String(name).toLowerCase()) !== "";

// Calls visit for every member of the archive at `path`, and settles once the listing is whole;
// rejects for anything it cannot read. The open is non-blocking and re-checked on the descriptor,
// so a FIFO is never waited on. A plain tar and a zip are read synchronously; a compressed tar
// streams.
export async function listArchive(path, name, visit) {
  const kind = kindOf(String(name).toLowerCase());
  if (!kind) throw new Error("format not read here");
  const fd = openSync(path, constants.O_RDONLY | (constants.O_NONBLOCK ?? 0));
  try {
    const st = fstatSync(fd);
    if (!st.isFile()) throw new Error("not a file");
    const reader = fileReader(fd, st.size);
    if (kind === "zip") return scanZip(reader, visit);
    if (kind === "tar") return scanTar(reader, visit);
    return await streamTar(fd, st.size, kind === "tgz" ? createGunzip() : createZstdDecompress(), visit);
  } finally {
    closeSync(fd);
  }
}

// ---- zip members (src/office.js) ----

/** A zip opened for reading single members: `names` in directory order, `sizes` by name, and
 * `read(name, cap)`, which answers the member's bytes, null for a name the zip does not hold, and
 * throws for a member over `cap`, encrypted, or stored by a method other than store and deflate.
 * `close()` releases the descriptor. */
export function openZip(path) {
  const fd = openSync(path, constants.O_RDONLY | (constants.O_NONBLOCK ?? 0));
  try {
    const st = fstatSync(fd);
    if (!st.isFile()) throw new Error("not a file");
    const reader = fileReader(fd, st.size),
      entries = new Map();
    scanZip(reader, (entry, raw) => {
      if (!entry.dir && !entries.has(entry.name)) entries.set(entry.name, { size: entry.size, ...raw });
    });
    return {
      names: [...entries.keys()],
      sizes: new Map([...entries].map(([name, entry]) => [name, entry.size])),
      read(name, cap) {
        const entry = entries.get(name);
        if (!entry) return null;
        if (entry.encrypted) throw new Error("encrypted zip member");
        if (entry.size > cap) throw new Error("zip member too large");
        const header = reader.read(entry.local, 30);
        if (header.length < 30 || header.readUInt32LE(0) !== 0x04034b50) throw new Error("bad local header");
        const data = reader.read(entry.local + 30 + header.readUInt16LE(26) + header.readUInt16LE(28), entry.compressed);
        if (data.length !== entry.compressed) throw new Error("truncated zip member");
        if (entry.method === 0) return data;
        if (entry.method !== 8) throw new Error("unsupported zip method");
        // The cap bounds the inflated bytes too, whatever size the directory claims.
        return inflateRawSync(data, { maxOutputLength: Math.max(1, cap) });
      },
      close: () => closeSync(fd),
    };
  } catch (error) {
    closeSync(fd);
    throw error;
  }
}

// The pieces src/archiveops.js reads member data with: extraction needs the type, mode, link and
// bytes of every member, which the listing above never keeps.
export { BLOCK, MAX_RECORD, checkedSize, checksumMatches, fileReader, kindOf, octal, paxRecords, scanZip, text };

// Extraction normalizes both separators and ignores empty/dot path components.
export function topLevelArchiveName(name) {
  return String(name).replaceAll("\\", "/").split("/").find(part => part && part !== ".") || "";
}
