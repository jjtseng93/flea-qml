import { test, expect, afterAll, beforeAll } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync, existsSync, symlinkSync, renameSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Paste's Replace and Merge (docs/protocol.md "transfer", "collisions", "mergecollisions"): the
// item already there goes to flea's Trash, a folder on a folder folds in, and only the names the
// questions saw are ever answered.
const root = mkdtempSync(join(tmpdir(), "flea-replace-"));
const saved = process.env.XDG_DATA_HOME;
process.env.XDG_DATA_HOME = join(root, "data");
const { collisions, mergeCollisions, transfer } = await import("../src/transfer.js");
afterAll(() => {
  if (saved === undefined) delete process.env.XDG_DATA_HOME;
  else process.env.XDG_DATA_HOME = saved;
  rmSync(root, { recursive: true, force: true });
});
const trashFiles = () => { try { return readdirSync(join(root, "data", "Trash", "files")); } catch { return []; } };

let serial = 0;
function place() {
  const at = join(root, String(++serial)), src = join(at, "src"), dest = join(at, "dest");
  mkdirSync(src, { recursive: true });
  mkdirSync(dest, { recursive: true });
  const messages = [];
  return { src, dest, messages, send: (m) => messages.push(m) };
}
async function run(p, request) {
  const from = p.messages.length;
  transfer(request, p.send, null, 0);
  for (let i = 0; i < 400; i++) {
    const done = p.messages.slice(from).find((m) => m.t === "transferdone");
    if (done) return { done, items: p.messages.slice(from).filter((m) => m.t === "transferitem") };
    await Bun.sleep(5);
  }
  throw Error("no transferdone: " + JSON.stringify(p.messages));
}
const ask = (p, id, paths) => { collisions({ id, paths, dest: p.dest }, p.send, null, 0); return p.messages.at(-1); };
const askMerge = (p, id, paths) => { mergeCollisions({ id, paths, dest: p.dest }, p.send, null, 0); return p.messages.at(-1); };

test("Replace sends the item already there to the Trash and lands the incoming one", async () => {
  const p = place(), before = trashFiles().length;
  writeFileSync(join(p.src, "a.txt"), "new");
  writeFileSync(join(p.dest, "a.txt"), "old");
  expect(ask(p, 1, [join(p.src, "a.txt")])).toMatchObject({ t: "collisions", total: 1, mergeable: false });
  const { done } = await run(p, { op: "copy", paths: [join(p.src, "a.txt")], dest: p.dest, collide: "replace", collideId: 1 });
  expect(done).toMatchObject({ ok: 1, failed: 0 });
  expect(done.into).toBeUndefined();
  expect(readFileSync(join(p.dest, "a.txt"), "utf8")).toBe("new");
  expect(trashFiles().length).toBe(before + 1);
});

test("Replace covers only what the question saw: a name swapped since is refused", async () => {
  const p = place();
  writeFileSync(join(p.src, "a.txt"), "new");
  writeFileSync(join(p.dest, "a.txt"), "old");
  ask(p, 2, [join(p.src, "a.txt")]);
  renameSync(join(p.dest, "a.txt"), join(p.dest, "gone"));
  writeFileSync(join(p.dest, "a.txt"), "swapped in");
  const { done, items } = await run(p, { op: "copy", paths: [join(p.src, "a.txt")], dest: p.dest, collide: "replace", collideId: 2 });
  expect(done.failed).toBe(1);
  expect(items[0].err).toBe("an item with that name is already there");
  expect(readFileSync(join(p.dest, "a.txt"), "utf8")).toBe("swapped in");
});

test("Replace refuses an item already there that holds the one moving in, and a link to itself", async () => {
  const p = place();
  // Moving dest/box/inner over dest-side "box" would trash its own source.
  mkdirSync(join(p.dest, "box"));
  mkdirSync(join(p.src, "box"));
  writeFileSync(join(p.dest, "box", "box"), "x");
  const nested = join(p.dest, "box", "box");
  const q = ask(p, 3, [nested]);
  // nested lives in dest/box, not dest, so it collides with dest/box itself.
  expect(q.total).toBe(1);
  const first = await run(p, { op: "move", paths: [nested], dest: p.dest, collide: "replace", collideId: 3 });
  expect(first.items[0].err).toBe("the item already there holds the one being moved in, so it was not replaced");
  expect(existsSync(nested)).toBe(true);
  if (process.platform === "win32") return;
  writeFileSync(join(p.dest, "t.txt"), "target");
  symlinkSync(join(p.dest, "t.txt"), join(p.src, "t.txt"));
  ask(p, 4, [join(p.src, "t.txt")]);
  const second = await run(p, { op: "copy", paths: [join(p.src, "t.txt")], dest: p.dest, collide: "replace", collideId: 4 });
  expect(second.items[0].err).toBe("the incoming link points at the item already there, so it was not replaced");
  expect(readFileSync(join(p.dest, "t.txt"), "utf8")).toBe("target");
});

test("a failed replace puts the item it trashed straight back", async () => {
  if (process.platform === "win32" || process.getuid?.() === 0) return;
  const p = place();
  mkdirSync(join(p.src, "d"));
  writeFileSync(join(p.src, "d", "secret"), "s");
  const { chmodSync } = await import("node:fs");
  chmodSync(join(p.src, "d"), 0o000);
  writeFileSync(join(p.dest, "d"), "old file");
  ask(p, 5, [join(p.src, "d")]);
  const { done, items } = await run(p, { op: "copy", paths: [join(p.src, "d")], dest: p.dest, collide: "replace", collideId: 5 });
  chmodSync(join(p.src, "d"), 0o755);
  expect(done.failed).toBe(1);
  expect(items[0].err).not.toContain("still in the Trash");
  expect(readFileSync(join(p.dest, "d"), "utf8")).toBe("old file");
});

function tree(p) {
  mkdirSync(join(p.src, "trip", "day1"), { recursive: true });
  mkdirSync(join(p.dest, "trip", "day1"), { recursive: true });
  writeFileSync(join(p.src, "trip", "new.jpg"), "new");
  writeFileSync(join(p.src, "trip", "day1", "same.jpg"), "incoming");
  writeFileSync(join(p.src, "trip", "day1", "fresh.jpg"), "fresh");
  writeFileSync(join(p.dest, "trip", "day1", "same.jpg"), "already");
  writeFileSync(join(p.dest, "trip", "keep.jpg"), "untouched");
  return [join(p.src, "trip")];
}

test("Merge is offered for a folder on a folder, and its walk lists the names both hold", () => {
  const p = place(), paths = tree(p);
  expect(ask(p, 10, paths)).toMatchObject({ total: 1, mergeable: true, names: [{ n: "trip", d: true }] });
  expect(askMerge(p, 10, paths)).toMatchObject({ t: "mergecollisions", id: 10, total: 1, names: [{ n: "same.jpg", d: false }] });
});

for (const [inner, expected, keptBoth] of [["keep", "already", 1], ["replace", "incoming", 0], ["skip", "already", 0]]) {
  test(`Merge folds the folders together, and "${inner}" answers the names both hold`, async () => {
    const p = place(), paths = tree(p);
    ask(p, 11, paths);
    askMerge(p, 11, paths);
    const { done } = await run(p, { op: "copy", paths, dest: p.dest, collide: "merge", collideId: 11, inner });
    expect(done).toMatchObject({ ok: 1, failed: 0, into: "trip", keptBoth, merged: 2 + keptBoth + (inner === "replace" ? 1 : 0) });
    const day1 = join(p.dest, "trip", "day1");
    expect(readFileSync(join(day1, "same.jpg"), "utf8")).toBe(expected);
    expect(readFileSync(join(day1, "fresh.jpg"), "utf8")).toBe("fresh");
    expect(readFileSync(join(p.dest, "trip", "new.jpg"), "utf8")).toBe("new");
    expect(readFileSync(join(p.dest, "trip", "keep.jpg"), "utf8")).toBe("untouched");
    if (inner === "keep") expect(readFileSync(join(day1, "same copy.jpg"), "utf8")).toBe("incoming");
    expect(existsSync(join(p.src, "trip", "day1", "same.jpg"))).toBe(true);
  });
}

test("a merging move removes the folders it emptied and leaves what it skipped", async () => {
  const p = place(), paths = tree(p);
  ask(p, 12, paths);
  askMerge(p, 12, paths);
  const { done } = await run(p, { op: "move", paths, dest: p.dest, collide: "merge", collideId: 12, inner: "skip" });
  expect(done).toMatchObject({ ok: 1, failed: 0, merged: 2 });
  expect(readdirSync(join(p.src, "trip"))).toEqual(["day1"]);
  expect(readdirSync(join(p.src, "trip", "day1"))).toEqual(["same.jpg"]);
  expect(readFileSync(join(p.dest, "trip", "day1", "fresh.jpg"), "utf8")).toBe("fresh");
});

test("a name that appears inside after the walk is refused whatever the inner answer", async () => {
  const p = place(), paths = tree(p);
  ask(p, 13, paths);
  askMerge(p, 13, paths);
  writeFileSync(join(p.dest, "trip", "new.jpg"), "late");
  const { done, items } = await run(p, { op: "copy", paths, dest: p.dest, collide: "merge", collideId: 13, inner: "replace" });
  expect(done.failed).toBe(1);
  expect(items[0].err).toBe("trip/new.jpg could not be copied: an item with that name is already there".replaceAll("/", join("a", "b")[1]));
  expect(readFileSync(join(p.dest, "trip", "new.jpg"), "utf8")).toBe("late");
  expect(readFileSync(join(p.dest, "trip", "day1", "same.jpg"), "utf8")).toBe("incoming");
});

test("merge without the walk folds nothing that both hold, and a bad inner word is refused", async () => {
  const p = place(), paths = tree(p);
  ask(p, 14, paths);
  // The second question was never asked: the transfer still merges, but same.jpg is refused.
  const { done } = await run(p, { op: "copy", paths, dest: p.dest, collide: "merge", collideId: 14, inner: "replace" });
  expect(done.failed).toBe(1);
  expect(readFileSync(join(p.dest, "trip", "day1", "same.jpg"), "utf8")).toBe("already");
  transfer({ op: "copy", paths, dest: p.dest, collide: "merge", collideId: 14, inner: "merge" }, p.send, null, 0);
  expect(p.messages.at(-1)).toMatchObject({ t: "error", where: "transfer" });
});

test("into names the merging folder only when it was the transfer's one item", async () => {
  const p = place(), paths = tree(p);
  writeFileSync(join(p.src, "a.txt"), "new");
  writeFileSync(join(p.dest, "a.txt"), "old");
  const both = [...paths, join(p.src, "a.txt")];
  ask(p, 15, both);
  askMerge(p, 15, both);
  const { done } = await run(p, { op: "copy", paths: both, dest: p.dest, collide: "merge", collideId: 15, inner: "keep" });
  expect(done.into).toBe("dest");
  const { readFileSync: read } = await import("node:fs");
  const source = read(new URL("../ui/js/Collide.js", import.meta.url), "utf8").replace(/^\.(?:pragma|import).*$/gm, "");
  const { mergeDest } = new Function("Format", "Ops", "Status", "Swap", source + ";return {mergeDest};")({}, {}, {}, {});
  const request = { dest: "/d" };
  expect(mergeDest(request, [{ n: "trip", d: true }], 1)).toBe("/d/trip");
  expect(mergeDest(request, [{ n: "trip", d: true }, { n: "a.txt", d: false }], 2)).toBe("/d");
});
