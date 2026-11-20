import { test, expect } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Listing } from "../src/listing.js";
import { thumb, thumbCancel, thumbsInit, CACHE_BYTES } from "../src/thumbs.js";

// A 1×1 GIF, drawn up to a real picture so the thumbnail has something to shrink.
const GIF = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";

async function folder() {
  const dir = mkdtempSync(join(tmpdir(), "flea-thumbs-"));
  writeFileSync(join(dir, "a.png"), await new Bun.Image(GIF).resize(800, 600, { fit: "fill" }).png().bytes());
  writeFileSync(join(dir, "b.jpg"), await new Bun.Image(GIF).resize(600, 900, { fit: "fill" }).jpeg().bytes());
  writeFileSync(join(dir, "broken.webp"), "not a picture");
  writeFileSync(join(dir, "notes.txt"), "text");
  mkdirSync(join(dir, "sub.png"));
  const listing = new Listing(dir, [
    { name: "a.png", dir: false, link: false },
    { name: "b.jpg", dir: false, link: false },
    { name: "broken.webp", dir: false, link: false },
    { name: "notes.txt", dir: false, link: false },
    { name: "sub.png", dir: true, link: false },
  ]);
  return { dir, listing };
}

function harness(listing) {
  const lines = [];
  const state = { listing, stamp: 1 };
  thumbsInit((line) => lines.push(line), () => state);
  const until = async (n) => { for (let i = 0; i < 400 && lines.length < n; i++) await Bun.sleep(10); };
  return { lines, state, until };
}

test("listing rows mark only pictures as thumbnailable", async () => {
  const { dir, listing } = await folder();
  try {
    const flags = listing.window(0, 10).rows.map((row) => [row.n, row.t]);
    expect(flags).toEqual([["a.png", true], ["b.jpg", true], ["broken.webp", true], ["notes.txt", false], ["sub.png", false]]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("each asked row gets one thumbed line with a small WebP data: URL, kept in memory only", async () => {
  const { dir, listing } = await folder();
  try {
    const { lines, until } = harness(listing);
    thumb({ rows: [0, 1, 2, 3, 4, 99] });
    // The text file and the folder answer at once; row 99 is past the listing and is skipped.
    expect(lines.map((l) => [l.row, l.file])).toEqual([[3, ""], [4, ""]]);
    await until(5);
    const byRow = Object.fromEntries(lines.map((l) => [l.row, l.file]));
    expect(Object.keys(byRow).sort()).toEqual(["0", "1", "2", "3", "4"]);
    for (const row of [0, 1]) {
      expect(byRow[row]).toMatch(/^data:image\/webp;base64,/);
      const meta = await new Bun.Image(byRow[row]).metadata();
      expect(Math.max(meta.width, meta.height)).toBe(256);
    }
    expect(byRow[2]).toBe(""); // not decodable
    // Nothing was written beside the pictures.
    expect((await Array.fromAsync(new Bun.Glob("*").scan(dir))).sort()).toEqual(["a.png", "b.jpg", "broken.webp", "notes.txt"]);
    // A second ask, even cache-only, answers from memory at once, the failure included.
    lines.length = 0;
    thumb({ rows: [0, 2], cacheOnly: true });
    expect(lines.map((l) => [l.row, l.file])).toEqual([[0, byRow[0]], [2, ""]]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("a cache-only miss answers empty without decoding", async () => {
  const { dir, listing } = await folder();
  try {
    // A fresh mtime is a fresh key, so the earlier test's kept picture does not answer.
    writeFileSync(join(dir, "a.png"), await new Bun.Image(GIF).resize(300, 300, { fit: "fill" }).png().bytes());
    const { lines } = harness(listing);
    thumb({ rows: [0], cacheOnly: true });
    expect(lines.map((l) => [l.row, l.file])).toEqual([[0, ""]]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("a sort or a new listing drops queued and finished work for the old numbering", async () => {
  const { dir, listing } = await folder();
  try {
    writeFileSync(join(dir, "b.jpg"), await new Bun.Image(GIF).resize(500, 500, { fit: "fill" }).jpeg().bytes());
    const { lines, state } = harness(listing);
    thumb({ rows: [1] });
    state.stamp = 2; // the listing was resorted while the picture was drawn
    await Bun.sleep(500);
    expect(lines).toEqual([]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("a cancelled row is not answered", async () => {
  const { dir, listing } = await folder();
  try {
    writeFileSync(join(dir, "a.png"), await new Bun.Image(GIF).resize(700, 700, { fit: "fill" }).png().bytes());
    writeFileSync(join(dir, "b.jpg"), await new Bun.Image(GIF).resize(710, 700, { fit: "fill" }).jpeg().bytes());
    writeFileSync(join(dir, "broken.webp"), await new Bun.Image(GIF).resize(720, 700, { fit: "fill" }).webp().bytes());
    const { lines } = harness(listing);
    // Two start at once; the third waits in the queue and is cancelled there.
    thumb({ rows: [0, 1, 2] });
    thumbCancel({ rows: [2] });
    await Bun.sleep(800);
    expect(lines.map((l) => l.row).sort()).toEqual([0, 1]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("SVG, ICO, CUR and WBMP are answered with the file itself, within their size limits", async () => {
  const dir = mkdtempSync(join(tmpdir(), "flea-thumbs-shown-"));
  try {
    const svg = (bytes) => `<svg xmlns="http://www.w3.org/2000/svg">${"<g/>".repeat(Math.ceil(bytes / 4))}</svg>`;
    writeFileSync(join(dir, "small.svg"), svg(8 << 10));
    writeFileSync(join(dir, "large.svg"), svg(20 << 10));
    writeFileSync(join(dir, "a.ico"), new Uint8Array(4096));
    writeFileSync(join(dir, "b.cur"), new Uint8Array(4096));
    writeFileSync(join(dir, "c.wbmp"), new Uint8Array(64));
    const names = ["small.svg", "large.svg", "a.ico", "b.cur", "c.wbmp"];
    const listing = new Listing(dir, names.map((name) => ({ name, dir: false, link: false })));
    expect(listing.window(0, 10).rows.every((row) => row.t === true)).toBe(true);
    const { lines } = harness(listing);
    thumb({ rows: [0, 1, 2, 3, 4] });
    // No decode happens here, so every answer is on the same line as the ask.
    expect(lines.map((l) => [l.row, l.file])).toEqual([
      [0, join(dir, "small.svg")], [1, ""], [2, join(dir, "a.ico")], [3, join(dir, "b.cur")], [4, join(dir, "c.wbmp")],
    ]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("the memory cache holds 50 MB of thumbnails", () => {
  expect(CACHE_BYTES).toBe(50 << 20);
  expect(Math.floor(CACHE_BYTES / (7 * 1024))).toBeGreaterThan(7000);
});
