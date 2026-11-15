// Mermaid diagrams for both Markdown previews: the passive HTML page (src/markdown-html.js) and
// the block view's figures (ui/FigureService.qml, through the backend's `figure` request).
//
// Pele runs in one Bun Worker (src/figure-thread.js), started on the first diagram and ended
// after a quiet spell. Diagrams go to it one at a time, each under a deadline: a layout still
// running then terminates the Worker, that diagram fails with a reason, and the next one starts
// a fresh Worker. The answers are SVG checked against an allowlist (src/figure-svg.js) and
// held in a small cache keyed by source and theme.
import { MERMAID_LIMIT } from "./figure-svg.js";

export const FIGURE_TIMEOUT_MS = 5000;
const IDLE_MS = 30000;
const CACHE_MAX = 64;
// A Gantt chart draws today's date: it is asked for this day's noon UTC, so every zone draws the day it is.
const MIDDAY_HOUR = 12;

const HEX = /^#[0-9a-f]{6}$/i;
const ADVANCES = 95; // printable ASCII, " " to "~"

/**
 * The theme a diagram is drawn under, from what a preview sends: colours as #rrggbb, a font
 * family, a body size, and the font's advance tables (thousandths of an em per character from
 * " " to "~", regular and bold) so every label is sized from the font that draws it. Anything
 * else is dropped, so a theme cannot carry markup into the SVG.
 */
export function figureTheme(theme = {}, source = "", now = new Date()) {
  const colour = (value, fallback) => (HEX.test(String(value ?? "")) ? String(value) : fallback);
  const table = (value) => Array.isArray(value) && value.length === ADVANCES && value.every((n) => Number.isFinite(n) && n >= 0)
    ? value.map(Number) : [];
  const fg = colour(theme.fg ?? theme.foreground, "#d8dee9");
  const out = {
    bg: colour(theme.bg ?? theme.background, "#171b22"), fg,
    accent: colour(theme.accent, fg), muted: colour(theme.muted, ""), surface: colour(theme.surface, ""),
    font: /^[\p{L}\p{N} _.,'-]{1,80}$/u.test(String(theme.font ?? "")) ? String(theme.font) : "sans-serif",
    bodyPx: Math.max(8, Math.min(40, Number(theme.bodyPx) || 14)),
    advances: table(theme.advances), boldAdvances: table(theme.boldAdvances),
  };
  if (/(?:^|%%)\s*gantt\b/im.test(source))
    out.today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate(), MIDDAY_HOUR);
  return out;
}

const cache = new Map();
const queue = [];
let worker = null, active = null, idleTimer = null, nextId = 0;

function stopWorker() {
  clearTimeout(idleTimer);
  idleTimer = null;
  worker?.terminate();
  worker = null;
}

function finish(job, answer) {
  clearTimeout(job.timer);
  if (answer.svg !== undefined) {
    cache.set(job.key, answer);
    if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
  }
  job.resolve(answer);
}

function pump() {
  if (active || !queue.length) {
    if (!active && worker && !idleTimer) idleTimer = setTimeout(stopWorker, IDLE_MS);
    return;
  }
  clearTimeout(idleTimer);
  idleTimer = null;
  active = queue.shift();
  if (!worker) {
    worker = new Worker(new URL("./figure-thread.js", import.meta.url).href);
    // The Worker never keeps the backend (or a test run) alive by itself.
    worker.unref?.();
    worker.onmessage = ({ data }) => {
      if (!active || data.id !== active.id) return;
      const job = active;
      active = null;
      finish(job, data.svg !== undefined ? { svg: data.svg } : { error: data.error || "render failed" });
      pump();
    };
    worker.onerror = (event) => {
      event.preventDefault?.();
      const job = active;
      active = null;
      stopWorker();
      if (job) finish(job, { error: String(event.message || "diagram engine failed") });
      pump();
    };
  }
  const job = active;
  job.timer = setTimeout(() => {
    if (active !== job) return;
    active = null;
    stopWorker();
    finish(job, { error: `diagram took over ${job.timeout / 1000} s` });
    pump();
  }, job.timeout);
  worker.postMessage({ id: job.id, source: job.source, theme: job.theme });
}

/**
 * Draws one Mermaid diagram. Answers {svg} or {error}; never rejects. `theme` is what a preview
 * sends (see figureTheme); `timeout` bounds the layout in ms.
 */
export function renderDiagram(source, theme = {}, { timeout = FIGURE_TIMEOUT_MS } = {}) {
  source = String(source ?? "");
  if (!source.trim()) return Promise.resolve({ error: "empty diagram" });
  if (source.length > MERMAID_LIMIT) return Promise.resolve({ error: "diagram over 32 KiB" });
  const drawn = figureTheme(theme, source);
  const key = JSON.stringify([source, drawn]);
  const hit = cache.get(key);
  if (hit) {
    cache.delete(key);
    cache.set(key, hit);
    return Promise.resolve(hit);
  }
  return new Promise((resolve) => {
    queue.push({ id: ++nextId, key, source, theme: drawn, timeout, resolve });
    pump();
  });
}

/** Ends the Worker and forgets the cache; queued diagrams fail. For tests and shutdown. */
export function stopFigures() {
  const pending = active ? [active, ...queue] : [...queue];
  active = null;
  queue.length = 0;
  stopWorker();
  cache.clear();
  for (const job of pending) finish(job, { error: "diagram engine stopped" });
}
