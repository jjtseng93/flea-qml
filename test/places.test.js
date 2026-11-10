import { test, expect, beforeEach, afterEach } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, posix, win32 } from "node:path";
import { appPackage, places, probePlaces, rootNames, userDirs } from "../src/places.js";

let root, home;
// Nothing of the machine running the tests is read: every source is named here.
const quiet = (extra = {}) => ({ home, env: {}, android: false, temps: [], roots: [], mounts: [], ...extra });
const folder = (...parts) => {
  const path = join(root, ...parts);
  mkdirSync(path, { recursive: true });
  return path;
};
const file = (...parts) => {
  folder(...parts.slice(0, -1));
  writeFileSync(join(root, ...parts), "x");
};
const labels = (rows) => rows.map((row) => row.label);

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "flea-places-"));
  home = folder("home");
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

test("user-dirs.dirs names a role's folder, the last valid line winning", () => {
  const dirs = userDirs(
    ['XDG_DOWNLOAD_DIR="$HOME/Old"', ' XDG_DOWNLOAD_DIR = "$HOME/下載" # inbox', 'XDG_MUSIC_DIR="/srv/music/"', 'XDG_PICTURES_DIR="relative"', 'XDG_VIDEOS_DIR="$HOME/a\\"b"', "XDG_DESKTOP_DIR=$HOME/Desktop"].join("\n"),
    "/home/a",
  );
  expect(Object.fromEntries(dirs)).toEqual({ DOWNLOAD: "/home/a/下載", MUSIC: "/srv/music", VIDEOS: '/home/a/a"b' });
});

test("an Android app is read off the temporary directory inside its private folder", () => {
  expect(appPackage("/data/data/com.termux/files/usr/tmp")).toEqual({ name: "com.termux", dir: "/data/data/com.termux" });
  expect(appPackage("/data/user/0/org.example.app_2/cache")).toEqual({ name: "org.example.app_2", dir: "/data/user/0/org.example.app_2" });
  expect(appPackage("/data/user/10/a.b")).toEqual({ name: "a.b", dir: "/data/user/10/a.b" });
  for (const other of ["/tmp", "/data/local/tmp", "/data/data/nodots/tmp", "/data/user/x/com.a.b/tmp", "/data/data/com.1a/tmp", "/sdcard/data/data/com.a.b", "", undefined])
    expect(appPackage(other)).toBeNull();
});

test("the roots are / where paths are POSIX and the drive letters where they are not", () => {
  expect(rootNames(posix)).toEqual(["/"]);
  const letters = rootNames(win32);
  expect(letters).toContain("C:\\");
  expect(letters.filter((name) => /^[A-Z]:\\$/.test(name)).length).toBe(26);
  expect(letters).not.toContain("/");
});

test("a folder is a place only once it directly holds a regular file", async () => {
  file("home", "Documents", "note.txt");
  file("home", "Downloads", "setup.bin");
  folder("home", "Music");
  folder("home", "Pictures", "Album");
  file("home", "Pictures", "Album", "deep.jpg");
  folder("home", "Videos");
  symlinkSync(join(home, "Documents", "note.txt"), join(home, "Videos", "link.txt"));
  const found = await probePlaces(quiet());
  expect(found.places).toEqual([
    { path: join(home, "Downloads"), label: "Downloads", glyph: "download" },
    { path: join(home, "Documents"), label: "Documents", glyph: "file-text" },
  ]);
  expect(found.volumes).toEqual([]);
  // The first file to land makes the row, and the folder's own change is what is noticed.
  writeFileSync(join(home, "Music", "song.ogg"), "x");
  expect(labels((await probePlaces(quiet())).places)).toEqual(["Downloads", "Documents", "Music"]);
});

test("user-dirs.dirs is tried before the names, and one folder is one row", async () => {
  file("home", "文件", "a.txt");
  file("home", "Documents", "b.txt");
  file("home", "Movies", "c.mkv");
  file("home", "Shared", "d.txt");
  symlinkSync(join(home, "Movies"), join(home, "Videos"));
  folder("home", ".config");
  writeFileSync(join(home, ".config", "user-dirs.dirs"), 'XDG_DOCUMENTS_DIR="$HOME/文件"\nXDG_PUBLICSHARE_DIR="$HOME/Shared"\nXDG_TEMPLATES_DIR="$HOME"\n');
  const found = await probePlaces(quiet());
  expect(found.places).toEqual([
    { path: join(home, "文件"), label: "文件", glyph: "file-text" },
    { path: join(home, "Videos"), label: "Videos", glyph: "film" },
    { path: join(home, "Shared"), label: "Shared", glyph: "folder" },
  ]);
});

test("temporary folders are probed and named once each", async () => {
  const a = folder("tmp-a"),
    b = folder("tmp-b");
  symlinkSync(a, join(root, "tmp-link"));
  const found = await probePlaces(quiet({ temps: [a, undefined, join(root, "tmp-link"), join(root, "missing"), "relative", b] }));
  expect(found.places).toEqual([
    { path: a, label: "Temp", glyph: "folder" },
    { path: b, label: b, glyph: "folder" },
  ]);
});

test("Android always has its shared storage and Download, and the app's own two folders", async () => {
  const shared = join(root, "shared");
  file("shared", "DCIM", "Camera", "IMG_1.jpg");
  file("shared", "DCIM", "stray.jpg");
  file("shared", "Pictures", "Screenshots", "s.png");
  folder("shared", "Documents");
  const app = folder("data", "data", "com.example.app");
  const found = await probePlaces(quiet({ android: true, shared, temps: ["/data/user/0/com.example.app/cache"] }));
  expect(found.places).toEqual([
    { path: shared, label: "Internal storage", glyph: "smartphone" },
    { path: join(shared, "Download"), label: "Download", glyph: "download" },
    { path: join(shared, "DCIM", "Camera"), label: "Camera", glyph: "camera" },
    { path: join(shared, "Pictures", "Screenshots"), label: "Screenshots", glyph: "image" },
    { path: join(shared, "Android", "media", "com.example.app"), label: "App media", glyph: "folder" },
  ]);
  expect(existsSync(join(shared, "Android", "media", "com.example.app"))).toBe(true);
  expect(existsSync(app)).toBe(true);
  // Without a camera folder holding files, DCIM itself is the camera's row.
  rmSync(join(shared, "DCIM", "Camera"), { recursive: true });
  expect(labels((await probePlaces(quiet({ android: true, shared }))).places)).toEqual(["Internal storage", "Download", "DCIM", "Screenshots"]);
});

test("a root that can be listed is a volume with its size, and one that cannot is not", async () => {
  const found = await probePlaces(quiet({ roots: [root, join(root, "gone"), root + "/"] }));
  expect(found.volumes.length).toBe(1);
  expect(found.volumes[0]).toMatchObject({ path: root, label: root, glyph: "drive" });
  expect(found.volumes[0].size).toBeGreaterThan(0);
});

test("the places request answers when asked, and a watch is ended by its own word", async () => {
  file("home", "Documents", "note.txt");
  const lines = [];
  await places({}, (line) => lines.push(line), quiet());
  await places({ watch: true }, (line) => lines.push(line), quiet());
  await places({ watch: false }, (line) => lines.push(line), quiet());
  expect(lines.length).toBe(2);
  expect(lines[0]).toEqual({ t: "places", places: [{ path: join(home, "Documents"), label: "Documents", glyph: "file-text" }], volumes: [] });
});
