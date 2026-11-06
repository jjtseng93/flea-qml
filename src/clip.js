// The clipboard requests: clipSet, clipGet, clipClear and clipWatch (docs/protocol.md), over
// Wayland data-control, so no window or focus is needed. Upstream: src/clip/.
//
// Unlike upstream there is no detached `--clip-own`: this backend holds its own selection and
// gives it up when it exits. What outlives it is the plain text, which a compositor such as
// buninu-land keeps after the owner is gone, so the text carries the whole selection:
//
//   '/home/a/file a' '/home/a/it'\''s'        a copy: each path shell-quoted, one space apart
//   ""'/home/a/file a' '/home/a/it'\''s'""    a cut: the same, between two empty "" strings
//
// Pasted into a POSIX shell, or bunmsh on any platform, both are the same arguments, since an
// empty "" joins the word beside it. Single quotes keep a newline in a name as it is.
import { randomBytes } from "node:crypto";
import { lstatSync } from "node:fs";
import { isAbsolute, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const FLEA = "application/x-flea-clip",
  GNOME = "x-special/gnome-copied-files",
  URILIST = "text/uri-list",
  KDE_CUT = "application/x-kde-cutselection",
  TEXT = ["text/plain;charset=utf-8", "text/plain", "UTF8_STRING"],
  PNG = "image/png";

const LIMIT = 8 * 1024 * 1024;
// A path's parts, split on this system's own separator and on '/', which every system accepts.
const PARTS = new RegExp(`[${sep === "\\" ? "\\\\" : sep}/]`);

// ---- the text form ----

export const quote = (s) => `'${s.replaceAll("'", "'\\''")}'`;

export function clipText(op, paths) {
  const words = paths.map(quote).join(" ");
  return op === "cut" ? `""${words}""` : words;
}

// The selection a text names, or null when it is anything but quoted paths that all exist.
// Sample inputs: `'/tmp/a' '/tmp/b'` -> copy of both; `""'/tmp/a'""` -> cut of /tmp/a.
export function parseClipText(text) {
  const named = readClipText(text);
  if (!named) return null;
  for (const path of named.paths) {
    try {
      lstatSync(path);
    } catch {
      // A spent cut's sources have moved away, so its text no longer names a selection.
      return null;
    }
  }
  return named;
}

// The same reading by shape alone, without asking the filesystem.
function readClipText(text) {
  let s = String(text).replace(/\r?\n$/, ""),
    op = "copy";
  if (s.length > 4 && s.startsWith('""') && s.endsWith('""')) {
    op = "cut";
    s = s.slice(2, -2);
  }
  const paths = [];
  let i = 0;
  for (;;) {
    while (s[i] === " ") i++;
    if (i >= s.length) break;
    let word = "";
    while (i < s.length && s[i] !== " ") {
      if (s[i] === "'") {
        const end = s.indexOf("'", i + 1);
        if (end < 0) return null;
        word += s.slice(i + 1, end);
        i = end + 1;
      } else if (s.startsWith("\\'", i)) {
        word += "'";
        i += 2;
      } else return null;
    }
    paths.push(word);
  }
  if (!paths.length || !paths.every(usable)) return null;
  return { op, paths };
}

// Absolute, NUL-free, and never through `.` or `..`.
function usable(path) {
  return typeof path === "string" && isAbsolute(path) && !path.includes("\0") && !path.split(PARTS).some((p) => p === "." || p === "..");
}

// ---- the file-manager forms ----

// Bun's own conversion, the inverse of the fileURLToPath that reads a uri-list back: it encodes
// what a URI cannot hold and takes a Windows drive letter or \\server\share path as Windows writes it.
export const encodeUri = (path) => pathToFileURL(path).href;

function decodeUris(lines) {
  const paths = [],
    seen = new Set();
  let skipped = 0;
  for (const line of lines) {
    let path = null;
    try {
      if (/^file:/i.test(line)) path = fileURLToPath(line);
    } catch {}
    if (path === null || !usable(path) || seen.has(path)) skipped++;
    else {
      seen.add(path);
      paths.push(path);
    }
  }
  return { paths, skipped };
}

export function parseGnome(text) {
  const [op, ...rest] = text.split("\n");
  if (op !== "copy" && op !== "cut") return null;
  return { op, ...decodeUris(rest.filter((l) => l)) };
}

export function parseUriList(text) {
  return decodeUris(
    text
      .split("\n")
      .map((l) => l.replace(/\r$/, ""))
      .filter((l) => l && !l.startsWith("#")),
  );
}

function parseFlea(text) {
  const [op, token] = text.replace(/^[\s\0]+|[\s\0]+$/g, "").split(" ");
  return (op === "copy" || op === "cut") && /^[0-9a-f]{32}$/i.test(token ?? "") ? { op, token } : null;
}

export function payloads(op, paths, token) {
  if (op === "text") return new Map(TEXT.map((m) => [m, Buffer.from(paths[0])]));
  const text = Buffer.from(clipText(op, paths)),
    out = new Map([
      [FLEA, Buffer.from(`${op} ${token} ${process.pid}`)],
      [GNOME, Buffer.from([op, ...paths.map(encodeUri)].join("\n"))],
      [URILIST, Buffer.from(paths.map((p) => `${encodeUri(p)}\r\n`).join(""))],
      ...TEXT.map((m) => [m, text]),
    ]);
  if (op === "cut") out.set(KDE_CUT, Buffer.from("1"));
  return out;
}

// ---- the data-control connection ----

let control = null;

class DataControl {
  constructor() {
    this.selection = null;
    this.offers = new Map();
    this.owned = null;
    this.onSelection = null;
    this.onClose = null;
  }
  async open() {
    // Loaded here, so a backend that never touches the clipboard never loads libc or kernel32.
    const { WaylandClient } = await import("./wayland/client.js");
    const io = await import("./wayland/resource-io.js");
    const { libc } = await import("./wayland/transport.js");
    this.io = io;
    this.libc = libc;
    const c = (this.client = new WaylandClient());
    await c.initialize();
    this.family = c.globals.has("ext_data_control_manager_v1")
      ? "ext_data_control"
      : c.globals.has("zwlr_data_control_manager_v1")
        ? "zwlr_data_control"
        : null;
    if (!this.family) {
      c.close();
      throw Error("the compositor offers no data-control clipboard");
    }
    this.manager = c.bind(`${this.family}_manager_v1`, 1);
    const seat = c.bind("wl_seat", 1);
    this.device = c.object(`${this.family}_device_v1`, (event, [id]) => {
      if (event === "data_offer") {
        const mimes = new Set();
        this.offers.set(id, mimes);
        c.objects.set(id, { iface: `${this.family}_offer_v1`, event: (name, [mime]) => name === "offer" && mimes.add(mime) });
      } else if (event === "selection") {
        this.drop(this.selection?.id, id);
        this.selection = id ? { id, mimes: this.offers.get(id) ?? new Set() } : null;
        this.onSelection?.();
      } else if (event === "primary_selection") this.drop(id, this.selection?.id);
      else if (event === "finished") c.close();
    });
    c.request(this.manager, "get_data_device", this.device, seat);
    c.onClose = () => {
      if (control === this) control = null;
      this.onClose?.();
    };
    await c.sync();
    return this;
  }
  drop(id, keep) {
    if (!id || id === keep || !this.offers.has(id)) return;
    this.offers.delete(id);
    try {
      this.client.request(id, "destroy");
    } catch {}
    this.client.objects.delete(id);
  }
  async transfer(fd, bytes) {
    const { readSync, writeSync } = this.io,
      chunks = [],
      deadline = Date.now() + 2000;
    let length = 0,
      offset = 0;
    try {
      this.libc.fcntl(fd, 4, this.libc.fcntl(fd, 3, 0) | 2048);
      while (!this.client.closed && Date.now() < deadline) {
        try {
          if (bytes) {
            if (offset === bytes.length) return;
            offset += writeSync(fd, bytes, offset, bytes.length - offset);
            continue;
          }
          const chunk = Buffer.alloc(65536),
            n = readSync(fd, chunk, 0, chunk.length, null);
          if (!n) return Buffer.concat(chunks).toString("utf8");
          length += n;
          if (length > LIMIT) throw Error("the clipboard holds more than 8 MB");
          chunks.push(chunk.subarray(0, n));
          continue;
        } catch (error) {
          if (!["EAGAIN", "EINTR", "EWOULDBLOCK"].includes(error.code)) throw error;
        }
        await Bun.sleep(4);
      }
      throw Error("the clipboard owner did not answer within 2 s");
    } finally {
      this.libc.close(fd);
    }
  }
  // The text the current selection offers as `mime`; a selection with no such type reads "".
  async read(mime) {
    const selection = this.selection;
    if (!selection?.mimes.has(mime)) return "";
    const fds = new Int32Array(2);
    if (this.libc.pipe2(fds, 2048 | 0x80000) < 0) throw Error("cannot make a clipboard pipe");
    try {
      this.client.request(selection.id, "receive", mime, fds[1]);
    } catch (error) {
      this.libc.close(fds[0]);
      throw error;
    } finally {
      this.libc.close(fds[1]);
    }
    return this.transfer(fds[0]);
  }
  async set(offered, owned) {
    const c = this.client,
      source = c.object(`${this.family}_source_v1`, (name, [mime, fd]) => {
        if (name === "send") {
          const bytes = offered.get(mime);
          if (bytes) this.transfer(fd, bytes).catch(() => {});
          else this.libc.close(fd);
        } else if (name === "cancelled") {
          if (this.owned?.source === source) this.owned = null;
          try {
            c.request(source, "destroy");
          } catch {}
        }
      });
    c.request(this.manager, "create_data_source", source);
    for (const mime of offered.keys()) c.request(source, "offer", mime);
    c.request(this.device, "set_selection", source);
    this.owned = { ...owned, source };
    await c.sync();
  }
  async clear() {
    const owned = this.owned;
    this.owned = null;
    this.client.request(this.device, "set_selection", 0);
    if (owned)
      try {
        this.client.request(owned.source, "destroy");
      } catch {}
    await this.client.sync();
  }
}

async function connect() {
  if (control && !control.client.closed) return control;
  const fresh = new DataControl();
  await fresh.open();
  control = fresh;
  return fresh;
}

const NONE = { clip: "none", paths: [], token: "", skipped: 0 };

// The selection as files, in upstream's order: Flea's own token, GNOME's list, the uri-list with
// KDE's cut marker, then the quoted text, which is all that is left once a Flea owner has exited.
async function snapshot(dc) {
  const selection = dc.selection,
    mimes = selection?.mimes;
  if (!mimes) return NONE;
  // This backend's own selection answers from what it offered, without a round trip through itself.
  if (dc.owned && dc.owned.op !== "text" && mimes.has(FLEA) && parseFlea(await dc.read(FLEA))?.token === dc.owned.token)
    return { clip: dc.owned.op, paths: dc.owned.paths, token: dc.owned.token, skipped: 0 };
  const textMime = TEXT.find((m) => mimes.has(m));
  const image = mimes.has(PNG) ? { ...NONE, clip: "image" } : NONE;
  if (mimes.has(FLEA)) {
    const flea = parseFlea(await dc.read(FLEA)),
      listed = mimes.has(GNOME) ? parseGnome(await dc.read(GNOME)) : null;
    if (!flea || !listed?.paths.length) return image;
    // A host clipboard (Android, Windows) can take other text without a new Wayland selection,
    // and buninu-land answers text from the host. Text in our shape, even an older selection's
    // while the host catches up, leaves the live owner's lists standing; any other text ends them.
    const text = textMime ? await dc.read(textMime) : "";
    if (text && !readClipText(text)) return image;
    return { clip: listed.op, paths: listed.paths, token: flea.op === listed.op ? flea.token : "", skipped: listed.skipped };
  }
  if (mimes.has(GNOME)) {
    const listed = parseGnome(await dc.read(GNOME));
    if (listed?.paths.length) return { clip: listed.op, paths: listed.paths, token: "", skipped: listed.skipped };
  }
  if (mimes.has(URILIST)) {
    const listed = parseUriList(await dc.read(URILIST));
    if (listed.paths.length) {
      const cut = mimes.has(KDE_CUT) && (await dc.read(KDE_CUT)).replace(/^[\s\0]+|[\s\0]+$/g, "") === "1";
      return { clip: cut ? "cut" : "copy", paths: listed.paths, token: "", skipped: listed.skipped };
    }
  }
  if (textMime) {
    const fromText = parseClipText(await dc.read(textMime));
    if (fromText) return { clip: fromText.op, paths: fromText.paths, token: "", skipped: 0 };
  }
  return image;
}

const sameSelection = (a, b) => a.clip === b.clip && a.token === b.token && a.paths.join("\0") === b.paths.join("\0");

// ---- the requests ----

export async function clipSet(request, send) {
  const op = request.op,
    paths = request.paths;
  const refuse = (error) => send({ t: "clip", op: "set", ok: false, error });
  if (!Array.isArray(paths) || !paths.length) return refuse("the clipboard names no path");
  if (op === "text") {
    if (paths.length !== 1 || typeof paths[0] !== "string" || paths[0].includes("\0")) return refuse("the text clipboard needs one NUL-free value");
  } else if (op !== "copy" && op !== "cut") return refuse("the clipboard operation must be copy or cut");
  else if (!paths.every(usable)) return refuse("a clipboard path is relative, holds a NUL or climbs through ..");
  const token = op === "text" ? "" : randomBytes(16).toString("hex");
  try {
    const dc = await connect();
    await dc.set(payloads(op, paths, token), { op, paths, token });
    send({ t: "clip", op: "set", ok: true, token });
  } catch (e) {
    refuse(e.message);
  }
}

export async function clipGet(_request, send) {
  try {
    send({ t: "clip", op: "get", ok: true, ...(await snapshot(await connect())) });
  } catch (e) {
    send({ t: "clip", op: "get", ok: false, error: e.message });
  }
}

export async function clipClear(request, send) {
  const answer = (cleared) => send({ t: "clip", op: "clear", ok: true, cleared });
  try {
    const dc = await connect();
    if (typeof request.token === "string" && request.token) {
      if (dc.owned?.token === request.token) {
        await dc.clear();
        return answer(true);
      }
      const offered = dc.selection;
      const flea = offered?.mimes.has(FLEA) ? parseFlea(await dc.read(FLEA)) : null;
      if (flea?.token !== request.token || dc.selection !== offered) return answer(false);
      await dc.client.sync();
      if (dc.selection !== offered) return answer(false);
      await dc.clear();
      return answer(true);
    }
    if (Array.isArray(request.cut)) {
      const offered = dc.selection,
        now = await snapshot(dc);
      if (now.clip !== "cut" || now.paths.join("\0") !== request.cut.join("\0") || dc.selection !== offered) return answer(false);
      await dc.client.sync();
      if (dc.selection !== offered) return answer(false);
      await dc.clear();
      return answer(true);
    }
    answer(false);
  } catch (e) {
    send({ t: "clip", op: "clear", ok: false, error: e.message });
  }
}

let watching = false;

// Reports every selection as files; two identical ones in a row report once. A dropped connection
// reconnects at most once a second, at most 5 times.
export function clipWatch(_request, send) {
  if (watching) return;
  watching = true;
  let last = null,
    sequence = 0,
    retries = 0;
  const report = (selection) => {
    if (last && sameSelection(last, selection)) return;
    last = selection;
    send({ t: "clip", op: "changed", ...selection });
  };
  const fail = (message) => {
    last = null;
    send({ t: "clip", op: "changed", ...NONE, error: message });
  };
  // A first connection that fails (no compositor, no data-control) ends the watcher at once.
  const start = async (first) => {
    let dc;
    try {
      dc = await connect();
    } catch (e) {
      return first ? fail(e.message) : retry(e.message);
    }
    retries = 0;
    const read = async () => {
      const mine = ++sequence;
      try {
        const selection = await snapshot(dc);
        if (mine === sequence) report(selection);
      } catch {}
    };
    dc.onSelection = read;
    dc.onClose = () => retry("the clipboard connection closed");
    read();
  };
  const retry = (message) => {
    if (++retries > 5) return fail(message);
    setTimeout(() => start(false), 1000).unref?.();
  };
  start(true);
}
