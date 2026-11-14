import { test, expect, afterAll } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dirsize, dirsizeCancel, dirsizeInit, forgetSizes, keptSize } from "../src/dirsize.js";
import { duCommand } from "../src/find.js";
import { Listing } from "../src/listing.js";

// Folder sizes only when asked (src/dirsize.js): du streams each folder's size, the answers are
// kept by path and ride later rows as z, and a change forgets a folder and those above it only.
const root = mkdtempSync(join(tmpdir(), "flea-dirsize-"));
afterAll(() => { try { chmodSync(join(root, "w", "c", "locked"), 0o755); } catch {} rmSync(root, { recursive: true, force: true }); });
const work = join(root, "w");
mkdirSync(join(work, "a", "deep"), { recursive: true });
mkdirSync(join(work, "b"));
mkdirSync(join(work, "-dash"));
mkdirSync(join(work, "c", "locked"), { recursive: true });
writeFileSync(join(work, "a", "one"), Buffer.alloc(1000));
writeFileSync(join(work, "a", "deep", "two"), Buffer.alloc(2500));
writeFileSync(join(work, "b", "three"), Buffer.alloc(7));
writeFileSync(join(work, "-dash", "x"), Buffer.alloc(11));
writeFileSync(join(work, "c", "locked", "hid"), Buffer.alloc(5));
writeFileSync(join(work, "file.txt"), "not a folder");

let listing = Listing.scan(work, false);
listing.sort({ by: "name", desc: false, foldersFirst: true, groupByKind: false, hiddenLast: false });
const messages = [];
dirsizeInit((m) => messages.push(m), () => listing);
const until = async (done) => {
  for (let i = 0; i < 400 && !done(); i++) await Bun.sleep(10);
  if (!done()) throw Error("timed out: " + JSON.stringify(messages));
};
const rowOf = (name) => listing.indexOfName(name);
const sizes = () => Object.fromEntries(messages.filter((m) => m.t === "dirsized").map((m) => [listing.rows[m.row].name, [m.bytes, m.partial]]));

test("du is looked for in Find's order: bunmsh first", () => {
  expect(duCommand().slice(-2)).toEqual(["builtin", "du"]);
});

test("nothing is measured until asked; one row asks for that folder alone", async () => {
  expect(listing.window(0, 10).rows.some((row) => row.z !== undefined)).toBe(false);
  dirsize({ rows: [rowOf("a"), rowOf("file.txt")] });
  await until(() => messages.some((m) => m.t === "dirsizedone"));
  expect(sizes()).toEqual({ a: [3500, false] });
  expect(keptSize(join(work, "a"))).toEqual({ bytes: 3500, partial: false });
});

test("all measures every folder, a name with a leading dash included, and an unreadable one is a floor", async () => {
  if (process.getuid?.() !== 0 && process.platform !== "win32") chmodSync(join(work, "c", "locked"), 0);
  messages.length = 0;
  dirsize({ all: true });
  await until(() => messages.some((m) => m.t === "dirsizedone"));
  const got = sizes();
  expect(got.a).toEqual([3500, false]);
  expect(got.b).toEqual([7, false]);
  expect(got["-dash"]).toEqual([11, false]);
  if (process.getuid?.() !== 0 && process.platform !== "win32") expect(got.c[1]).toBe(true);
  expect(got["file.txt"]).toBeUndefined();
  chmodSync(join(work, "c", "locked"), 0o755);
});

test("kept sizes ride later rows, follow a sort, and a change forgets only its own line upward", () => {
  listing = Listing.scan(work, false);
  listing.sort({ by: "name", desc: true, foldersFirst: true, groupByKind: false, hiddenLast: false });
  const rows = Object.fromEntries(listing.window(0, 10).rows.map((row) => [row.n, row]));
  expect(rows.a.z).toBe(3500);
  expect(rows.b.z).toBe(7);
  expect(rows["file.txt"].z).toBeUndefined();
  // A write inside a/deep: a (and everything above) is no longer known, b still is.
  forgetSizes(join(work, "a", "deep"));
  expect(keptSize(join(work, "a"))).toBeUndefined();
  expect(keptSize(join(work, "b"))).toEqual({ bytes: 7, partial: false });
  forgetSizes(join(work, "b", "three-sibling-dir-does-not-exist"));
  expect(keptSize(join(work, "b"))).toBeUndefined();
  expect(keptSize(join(work, "-dash"))).toEqual({ bytes: 11, partial: false });
});

test("a cancel stops the run and says so", async () => {
  messages.length = 0;
  dirsize({ all: true });
  dirsizeCancel();
  await until(() => messages.some((m) => m.t === "dirsizedone"));
  expect(messages.find((m) => m.t === "dirsizedone").cancelled).toBe(true);
});

// The cell side (ui/js/DirSizes.js): ⚖️ until measured, … while a walk is out, then the size.
async function loadJs(name, names, deps = {}) {
  const s = (await Bun.file(new URL("../ui/js/" + name + ".js", import.meta.url)).text()).replace(/^\.(?:pragma|import).*$/gm, "");
  return new Function(...Object.keys(deps), s + ";return {" + names + "};")(...Object.values(deps));
}
const Format = { size: (n) => `${n} B` };
const D = await loadJs("DirSizes", "empty,cellFor,known,folderText,asking,askingAll,remember,settled,UNMEASURED,MEASURING", { Format });

test("a folder's Size cell reads ⚖️, then … while asked, then its size; a row's z stands in after a sort", () => {
  let state = D.empty();
  const row = { d: true };
  expect(D.folderText(D.cellFor(state, 4), row)).toBe("⚖️");
  state = D.asking(state, [4]);
  expect(D.folderText(D.cellFor(state, 4), row)).toBe("…");
  expect(D.folderText(D.cellFor(state, 5), row)).toBe("⚖️");
  state = D.remember(state, 4, 2048, false, 100);
  expect(D.folderText(D.cellFor(state, 4), row)).toBe("\u2696\ufe0f 2048 B");
  expect(D.folderText(D.cellFor(D.empty(), 4), { d: true, z: 9, zp: true })).toBe("\u2696\ufe0f >9 B");
});

test("the header's ⚖️ makes every folder wait until its answer or the run's end", () => {
  let state = D.askingAll(D.empty());
  expect(D.cellFor(state, 900)).toEqual({ waiting: true });
  state = D.remember(state, 3, 10, false, 100);
  expect(D.cellFor(state, 3)).toEqual({ bytes: 10, partial: false });
  expect(D.cellFor(state, 7)).toEqual({ waiting: true });
  state = D.settled(state);
  expect(D.cellFor(state, 7)).toBe(null);
  expect(D.cellFor(state, 3)).toEqual({ bytes: 10, partial: false });
});

test("a size order uses measured folders' sizes and puts unmeasured folders after them, measuring nothing", () => {
  // a and b were forgotten above; -dash (11) and c (a floor) are still measured.
  const fresh = Listing.scan(work, false);
  fresh.sort({ by: "name", desc: false, foldersFirst: true, groupByKind: false, hiddenLast: false });
  fresh.sort({ by: "size", desc: true, foldersFirst: true, groupByKind: false, hiddenLast: false });
  expect(fresh.rows.filter((r) => r.dir).map((r) => r.name)).toEqual(["-dash", "c", "a", "b"]);
  expect(messages.filter((m) => m.t === "dirsized").length).toBe(0);
});

test("= measures the selection or the cursor's folder, Alt+= every folder", async () => {
  // Every Qt.Key_* the table names gets a distinct number; the modifiers are Qt's own.
  let next = 1000;
  const named = { AltModifier: 0x08000000, ControlModifier: 0x04000000, ShiftModifier: 0x02000000, MetaModifier: 0x10000000, Key_Equal: 0x3d };
  const Qt = new Proxy(named, { get: (t, k) => (k in t ? t[k] : (t[k] = next++)) });
  const Keymap = await loadJs("Keymap", "lookup", { Qt });
  expect(Keymap.lookup(0x3d, "=", 0)).toBe("measureDirs");
  expect(Keymap.lookup(0x3d, "=", named.AltModifier)).toBe("measureAllDirs");
  // Ctrl+= stays the text size.
  expect(Keymap.lookup(0x3d, "=", named.ControlModifier)).toBe("textSizeUp");
  const focus = await Bun.file(new URL("../ui/js/Focus.js", import.meta.url)).text();
  expect(focus).toContain('case "measureDirs": root.measureDirs(root.selectionCount() > 0 ? root.selectedIndices() : [root.cursorIndex])');
});
