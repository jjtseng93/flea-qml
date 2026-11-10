// The sidebar's probed places (docs/protocol.md "flea-qml probed places"): the folders under
// PLACES and the drives under DEVICES that this machine really has, found by looking at the
// filesystem and nothing else. Upstream reads user-dirs.dirs for the first and asks lsblk for the
// second, so a system with neither shows Home alone and a folder the file names is drawn whether
// or not it exists. Here every system is asked the same questions and the rows are what answers.
// No outside program runs, and the looking lives in the backend, so it ends with it.
import { lstatSync } from "node:fs";
import { lstat, mkdir, readFile, readdir, stat, statfs } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { basename, isAbsolute, join, resolve, sep } from "node:path";

const POLL_MS = 5000,
  // How long one look may take before its row is left out of this answer; the look itself runs
  // on, and its row arrives with the answer after it lands.
  LOOK_MS = 2000,
  // A folder known to hold a file is listed again at most this often while it keeps changing: a
  // camera folder of thousands of photos costs a tenth of a second to list.
  RELIST_MS = 60_000;

// The folders a user's files go by, under home and under Android's shared storage alike. The
// first name that passes is the row; `role` is user-dirs.dirs' own word, whose path is tried
// before the names. A folder is a row only once it directly holds a regular file: an empty one,
// or one holding only folders, is somewhere nobody keeps anything yet.
const FOLDERS = [
  { role: "DESKTOP", glyph: "folder", names: ["Desktop"] },
  { role: "DOWNLOAD", glyph: "download", names: ["Downloads", "Download"] },
  { role: "DOCUMENTS", glyph: "file-text", names: ["Documents"] },
  { role: "PICTURES", glyph: "image", names: ["Pictures"] },
  { role: "CAMERA", glyph: "camera", names: ["DCIM/Camera", "DCIM", "Pictures/Camera Roll"] },
  { role: "SCREENSHOTS", glyph: "image", names: ["Pictures/Screenshots", "DCIM/Screenshots"] },
  { role: "MUSIC", glyph: "music", names: ["Music"] },
  { role: "VIDEOS", glyph: "film", names: ["Videos", "Movies"] },
  { role: "TEMPLATES", glyph: "folder", names: [] },
  { role: "PUBLICSHARE", glyph: "folder", names: [] },
];

// Where removable drives are mounted, by each system's convention, and how many folders lie
// between the name and the drive: /Volumes/NAME, /media/NAME or /media/USER/NAME, /run/media/USER/NAME.
const MOUNTS = [
  { dir: "/Volumes", depth: 0 },
  { dir: "/media", depth: 1 },
  { dir: "/run/media", depth: 1 },
];
// Android's own two entries under /storage, which are the shared storage and not a card.
const STORAGE_OWN = ["emulated", "self"];

// One look at a path at a time, and none awaited past LOOK_MS: a drive that stopped answering (a
// network share gone away) leaves its own row out instead of holding every other row back, and a
// look still out is joined, never started again. A look that fails answers null.
const looks = new Map();
function look(key, run) {
  let flight = looks.get(key);
  if (!flight) {
    flight = run()
      .catch(() => null)
      .finally(() => looks.delete(key));
    looks.set(key, flight);
  }
  let timer;
  const late = new Promise((done) => {
    timer = setTimeout(done, LOOK_MS, null);
  });
  return Promise.race([flight, late]).finally(() => clearTimeout(timer));
}

// A folder's identity, or null for anything else. bigint, because a Windows file index does not
// fit a double and two folders must never round into one; a filesystem that numbers nothing is
// told apart by path.
const folder = (path) =>
  look(`folder:${path}`, async () => {
    const st = await stat(path, { bigint: true });
    if (!st.isDirectory()) return null;
    return { dev: st.dev, id: st.ino ? `${st.dev}:${st.ino}` : `path:${path}`, stamp: `${st.dev}:${st.ino}:${st.mtimeNs}` };
  });

// Whether a folder directly holds a regular file: a folder of folders does not count, nor a link.
async function anyFile(path) {
  let asked = 0;
  for (const entry of await readdir(path, { withFileTypes: true })) {
    if (entry.isFile()) return true;
    // A filesystem that names no types leaves every test false; a few of those are asked directly.
    const typed = entry.isDirectory() || entry.isSymbolicLink() || entry.isFIFO() || entry.isSocket() || entry.isCharacterDevice() || entry.isBlockDevice();
    if (typed || asked++ >= 16) continue;
    try {
      if ((await lstat(join(path, entry.name))).isFile()) return true;
    } catch {}
  }
  return false;
}

// The folder when it holds a file, else null. The answer is kept against the folder's own change
// time, so a quiet folder costs one stat however large it is; an empty one is always read again.
const fileful = new Map();
async function holdsFile(path) {
  const here = await folder(path);
  if (!here) return null;
  const known = fileful.get(path),
    now = Date.now();
  if (known?.has && (known.stamp === here.stamp || now - known.read < RELIST_MS)) return here;
  const has = await look(`files:${path}`, () => anyFile(path));
  // A listing that ran out of time keeps the last answer rather than dropping a row that was there.
  if (has === null) return known?.has ? here : null;
  fileful.set(path, { stamp: here.stamp, has, read: now });
  return has ? here : null;
}

// Sample input: XDG_DOWNLOAD_DIR="$HOME/下載" names DOWNLOAD as /home/a/下載. The last valid line
// of a role wins, as upstream's ui/js/UserDirs.js reads it; a relative path names nothing.
export function userDirs(text, home) {
  const roles = new Map();
  for (const line of String(text ?? "").split("\n")) {
    const pair = /^[ \t]*XDG_([A-Z]+)_DIR[ \t]*=[ \t]*"(\$HOME(?=\/|"))?((?:\\[\s\S]|[^"\\])*)"/.exec(line);
    if (!pair) continue;
    const rest = pair[3].replace(/\\([\s\S])/g, "$1"),
      path = pair[2] ? home + rest : rest;
    if (isAbsolute(path)) roles.set(pair[1], resolve(path));
  }
  return roles;
}

// The Android app whose private folder holds this temporary directory, which is how an app's
// own shell names itself. Sample input: /data/data/com.termux/files/usr/tmp gives com.termux in
// /data/data/com.termux, and /data/user/0/org.example.app/cache the same under /data/user/0.
export function appPackage(tmp) {
  const found = /^(\/data\/(?:data|user\/\d+)\/([A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*)+))(?:\/|$)/.exec(String(tmp ?? ""));
  return found ? { name: found[2], dir: found[1] } : null;
}

// Every root this system's paths can start from: "/" where paths are POSIX, the drive letters
// where they are not. node:path decides which, so one list serves every system: POSIX reads
// "C:\" as a relative name and drops it, and Windows reads "/" as the current drive's root, which
// is one of the letters already.
export function rootNames(path = { isAbsolute, resolve }) {
  const names = ["/", ...Array.from("ABCDEFGHIJKLMNOPQRSTUVWXYZ", (letter) => `${letter}:\\`)];
  return [...new Set(names.filter((name) => path.isAbsolute(name)).map((name) => path.resolve(name)))];
}

// What is mounted under a mount folder: a folder on another device than the one holding it.
// One on the same device is a per-user folder, looked into while `depth` allows.
async function mountedUnder(dir, depth, skip = []) {
  const here = await folder(dir);
  if (!here) return [];
  const names = (await look(`names:${dir}`, () => readdir(dir))) ?? [],
    out = [];
  for (const name of names.sort()) {
    if (skip.includes(name)) continue;
    const child = join(dir, name),
      at = await folder(child);
    if (!at) continue;
    if (at.dev !== here.dev) out.push({ path: child, at });
    else if (depth > 0) out.push(...(await mountedUnder(child, depth - 1)));
  }
  return out;
}

// Android is told by its own linker being there, which a Linux userland running on it still sees
// and which no platform name says. The name alone counts, wherever its link leads.
function onAndroid() {
  try {
    lstatSync("/system/bin/linker64");
    return true;
  } catch {
    return false;
  }
}

const tilde = (path, home) => (path.startsWith(home + sep) ? `~${path.slice(home.length)}` : path);

// The app's shared media folder is made once per run when missing, so one a user removed stays
// removed until the next start.
const made = new Set();

// The answer itself: { places, volumes }, each row { path, label, glyph }, a volume with its
// `size` in bytes or null. `given` replaces what is read from the machine, for the tests.
export async function probePlaces(given = {}) {
  const env = given.env ?? process.env,
    home = resolve(given.home ?? (env.HOME || homedir())),
    android = given.android ?? onAndroid(),
    shared = given.shared ?? "/sdcard",
    temps = given.temps ?? [tmpdir(), env.TMPDIR, "/tmp"],
    places = [],
    taken = new Set();
  const add = (row, at) => {
    const id = at ? at.id : `path:${row.path}`;
    if (taken.has(id)) return;
    taken.add(id);
    places.push(row);
  };
  // Home is the rail's own first row, so a folder that is home again is no second one.
  const homeAt = await folder(home);
  if (homeAt) taken.add(homeAt.id);

  const folders = async (root, dirs) => {
    const found = await Promise.all(
      FOLDERS.map(async (kind) => {
        const named = dirs.get(kind.role);
        for (const path of [...(named ? [named] : []), ...kind.names.map((name) => join(root, name))]) {
          const at = await holdsFile(path);
          if (at) return { row: { path, label: basename(path), glyph: kind.glyph }, at };
        }
        return null;
      }),
    );
    for (const one of found) if (one) add(one.row, one.at);
  };

  let dirs = new Map();
  try {
    dirs = userDirs(await readFile(join(env.XDG_CONFIG_HOME || join(home, ".config"), "user-dirs.dirs"), "utf8"), home);
  } catch {}
  await folders(home, dirs);

  if (android) {
    // The floor: the shared storage and its Download are rows whatever they answer.
    add({ path: shared, label: "Internal storage", glyph: "smartphone" }, await folder(shared));
    const download = join(shared, "Download");
    add({ path: download, label: "Download", glyph: "download" }, await folder(download));
    await folders(shared, new Map());
    const app = temps.map(appPackage).find(Boolean);
    if (app) {
      const media = join(shared, "Android", "media", app.name);
      if (!made.has(media)) {
        made.add(media);
        await look(`make:${media}`, () => mkdir(media, { recursive: true }));
      }
      for (const [path, label] of [[media, "App media"], [app.dir, "App data"]]) {
        const at = await folder(path);
        if (at) add({ path, label, glyph: "folder" }, at);
      }
    }
  }

  for (const name of temps) {
    if (!name || !isAbsolute(name)) continue;
    const path = resolve(name),
      at = await folder(path);
    if (at) add({ path, label: "Temp", glyph: "folder" }, at);
  }

  // Two rows never share a label: the later one is named by its whole path, home written ~.
  const used = new Set(["Home", "Recent", "Trash"]);
  for (const row of places) {
    if (used.has(row.label)) row.label = tilde(row.path, home);
    used.add(row.label);
  }

  const volumes = [],
    seen = new Set(),
    named = new Set();
  // A drive is one row however many names reach it, with its size when the filesystem tells it.
  const volume = async (path, at, label) => {
    if (seen.has(at.id)) return;
    seen.add(at.id);
    const size = await look(`size:${path}`, async () => {
      const fs = await statfs(path);
      return Number(fs.bsize) * Number(fs.blocks);
    });
    const name = named.has(label) ? path : label;
    named.add(name);
    volumes.push({ path, label: name, glyph: "drive", size: size > 0 ? size : null });
  };
  // A root is a row when it can be listed, which an empty card reader or a locked drive cannot;
  // its label is itself without the trailing separator, so "C:" and "/".
  const roots = await Promise.all(
    (given.roots ?? rootNames()).map(async (path) => ((await look(`list:${path}`, () => readdir(path))) ? { path, at: await folder(path) } : null)),
  );
  for (const root of roots) if (root?.at) await volume(root.path, root.at, root.path.replace(/[\\/]+$/, "") || root.path);
  const mounts = given.mounts ?? [...MOUNTS, ...(android ? [{ dir: given.storage ?? "/storage", depth: 0, skip: STORAGE_OWN }] : [])];
  for (const mount of mounts)
    for (const found of await mountedUnder(mount.dir, mount.depth, mount.skip)) await volume(found.path, found.at, basename(found.path));
  // QML navigation uses forward slashes; keep native separators inside IO only.
  if (process.platform === "win32")
    for (const row of [...places, ...volumes]) row.path = row.path.replaceAll("\\", "/");
  return { places, volumes };
}

let timer = null,
  sent = null,
  busy = false,
  owed = false;

// Looks, and sends a `places` line when asked for one or when the answer changed.
async function report(send, asked, given) {
  if (busy) {
    owed ||= asked;
    return;
  }
  busy = true;
  try {
    const found = await probePlaces(given),
      text = JSON.stringify(found);
    if (asked || owed || text !== sent) send({ t: "places", ...found });
    sent = text;
  } catch (error) {
    console.error(`flea-qml backend: places: ${error?.message ?? error}`);
  } finally {
    busy = false;
    owed = false;
  }
}

// The `places` request: an answer now, and with `watch` true a fresh look every five seconds
// until `watch` false, which a rail sends while it is shown. Nothing looks while no rail asks.
export function places(request, send, given) {
  if (request.watch === true && !timer) {
    timer = setInterval(() => report(send, false, given), POLL_MS);
    timer.unref?.();
  } else if (request.watch === false && timer) {
    clearInterval(timer);
    timer = null;
  }
  return request.watch === false ? Promise.resolve() : report(send, true, given);
}
