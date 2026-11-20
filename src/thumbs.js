// Thumbnails for the rows a client names (docs/protocol.md "thumb", "thumbcancel"). Upstream asks
// external thumbnailers and keeps PNGs in ~/.cache/thumbnails; here Bun.Image draws each picture
// into a WebP of at most 256 px (about 5–7 KB) and nothing is written to disk: the picture goes back
// as a data: URL in `thumbed`'s `file`, and the backend keeps it in memory only, bounded, for the
// next ask of the same file at the same mtime. Only rows a client named are ever looked at.
import { statSync } from "node:fs";
import { join } from "node:path";

/** The pictures Bun.Image decodes everywhere; HEIC, AVIF and TIFF need an OS codec. */
const DRAWN_NAME = /\.(?:jpe?g|png|webp|gif|bmp)$/i;
// Pictures Bun.Image cannot read but the window's own image decoder always can: ICO, CUR and WBMP
// are codecs built into Skia (CanvasKit), and SVG is buninu-browser's own. These are not redrawn
// here: the answer is the file itself, which the tile decodes at its own size. The decode runs in the
// window, so a file past its limit is answered empty and keeps its glyph rather than stall a frame.
// Measured in Grid (60 tiles, scrolling 240 px a step): an SVG costs by its content, about 16 KB
// keeps the slowest step near a quarter second (5 KB: 0.14 s, 16 KB: 0.25 s, 24 KB: every step
// 0.18 s, 47 KB: 0.5–0.9 s, 233 KB: 2–3 s); a 240 KB ICO stays at 0.14 s, so the raster ones get 1 MB.
const SHOWN_NAME = /\.(?:svg|ico|cur|wbmp)$/i;
const SHOWN_MAX = { svg: 16 << 10, ico: 1 << 20, cur: 1 << 20, wbmp: 1 << 20 };
/** Every picture a row can show as its thumbnail, drawn here or shown as itself. */
export const THUMB_NAME = /\.(?:jpe?g|png|webp|gif|bmp|svg|ico|cur|wbmp)$/i;
const SIDE = 256, QUALITY = 70;
// A source larger than this is answered empty rather than decoded for a 7 KB picture.
const SOURCE_MAX = 64 << 20;
// Kept thumbnails, by path, size and mtime: 50 MB of WebP, about 7000 pictures of 7 KB. Past it
// the least recently used goes first, so a new picture always replaces an old one.
export const CACHE_BYTES = 50 << 20;
// Queued work; past it the oldest job is dropped and its row answered empty.
const QUEUE_MAX = 512;
// Decodes at once: Bun.Image works off the JS thread, so two keep a core busy without starving one.
const WORKERS = 2;

const cache = new Map(); // key -> data: URL, or "" for a recorded failure
let cacheBytes = 0;
const queue = new Map(); // row -> job, oldest first
let queueStamp = -1, running = 0;
let send = () => {}, current = () => ({ listing: null, stamp: 0 });

export function thumbsInit(sender, listingOf) {
  send = sender;
  current = listingOf;
}

const keyOf = (path, st) => `${path}\0${st.size}\0${st.mtimeMs}`;
// The WebP bytes a kept data: URL holds, which is what the 50 MB counts.
// A recorded failure ("") counts a little, so failures alone cannot grow without bound.
const weight = (url) => url ? Math.floor((url.length - url.indexOf(",") - 1) * 3 / 4) : 64;

function keep(key, url) {
  const old = cache.get(key);
  if (old !== undefined) { cache.delete(key); cacheBytes -= weight(old); }
  cache.set(key, url);
  cacheBytes += weight(url);
  for (const [k, v] of cache) {
    if (cacheBytes <= CACHE_BYTES) break;
    cache.delete(k);
    cacheBytes -= weight(v);
  }
}

function recall(key) {
  const url = cache.get(key);
  if (url === undefined) return undefined;
  // Most recently used last, so a scroll back finds what it just showed.
  cache.delete(key);
  cache.set(key, url);
  return url;
}

const answer = (row, file, started) =>
  send({ t: "thumbed", row, file, ms: Math.round((performance.now() - started) * 1000) / 1000 });

/** The path a row's thumbnail is drawn from, or null for a row that cannot have one. */
export function thumbSource(listing, row) {
  if (!listing || !row || row.dir) return null;
  const path = row.trash?.file ?? join(listing.path || ".", row.name);
  return THUMB_NAME.test(row.trash ? row.trash.original || row.name : row.name) ? path : null;
}

/** `thumb`: { rows: [...], cacheOnly? }; one `thumbed` per row, at once or when drawn. */
export function thumb(request) {
  const { listing, stamp } = current();
  if (!listing) return;
  // A list or a sort renumbered the rows: queued work names rows that no longer exist.
  if (stamp !== queueStamp) { queue.clear(); queueStamp = stamp; }
  const rows = Array.isArray(request.rows) ? request.rows.filter(Number.isInteger) : [];
  for (const index of rows) {
    const started = performance.now();
    const row = listing.rows[index];
    if (!row) continue;
    const path = thumbSource(listing, row);
    let st = null;
    try { st = path && statSync(path); } catch {}
    if (!st || !st.isFile() || st.size > SOURCE_MAX) { answer(index, "", started); continue; }
    const shown = SHOWN_NAME.exec(path);
    if (shown) { answer(index, st.size <= SHOWN_MAX[shown[0].slice(1).toLowerCase()] ? path : "", started); continue; }
    if (!DRAWN_NAME.test(path)) { answer(index, "", started); continue; }
    const key = keyOf(path, st);
    const kept = recall(key);
    if (kept !== undefined) { answer(index, kept, started); continue; }
    if (request.cacheOnly === true) { answer(index, "", started); continue; }
    queue.delete(index);
    queue.set(index, { row: index, path, key, stamp, started });
    if (queue.size > QUEUE_MAX) {
      const [oldest] = queue.keys();
      queue.delete(oldest);
      answer(oldest, "", started);
    }
  }
  pump();
}

/** `thumbcancel`: drops queued rows, all of them when `rows` is empty; answers nothing. */
export function thumbCancel(request) {
  const rows = Array.isArray(request.rows) ? request.rows : [];
  if (rows.length === 0) queue.clear();
  else for (const row of rows) queue.delete(row);
}

function pump() {
  while (running < WORKERS && queue.size) {
    const [row] = queue.keys();
    const job = queue.get(row);
    queue.delete(row);
    if (job.stamp !== current().stamp) continue;
    running++;
    draw(job).finally(() => { running--; pump(); });
  }
}

async function draw(job) {
  let url = "";
  try {
    const bytes = await new Bun.Image(job.path).resize(SIDE, SIDE, { fit: "inside" }).webp({ quality: QUALITY }).bytes();
    url = `data:image/webp;base64,${Buffer.from(bytes).toString("base64")}`;
  } catch {}
  // A failure is kept too, so the same file at the same mtime is not decoded again.
  keep(job.key, url);
  // A result for a listing since replaced or resorted is dropped, never sent against a new row.
  if (current().stamp === job.stamp) answer(job.row, url, job.started);
}
