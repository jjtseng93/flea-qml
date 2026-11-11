// The `code` line: a window of a file's or a text's lines for the preview (docs/protocol.md
// "code"). Lines are coloured by jsmdcui when it can be found (src/highlight.js) and answered
// plain otherwise. Upstream: src/backend/code.rs, which runs `bat`.
// Not done yet: jq formatting of one-line JSON.
import { closeSync, fstatSync, mkdtempSync, openSync, readSync, rmSync, statSync, writeFileSync, constants } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { highlightFile } from "./highlight.js";
import { previewLanguage } from "./preview-language.js";
import { officeKind, officePreview } from "./office.js";

// Bound IO and layout work: large files show their prefix, never a refusal.
const BYTE_LIMIT = 1 << 20;
// One reply carries at most this many lines; ui/CodeLines.qml asks a longer window in parts.
const LINE_CAP = 400;
// jsmdcui renders Markdown as a document rather than colouring its source, so its lines would not
// be the file's; Markdown is answered plain.
const RENDERED = /\.(md|markdown|mkd)$/i;

// An office document's lines are its extracted text, or its first sheet as CSV (src/office.js);
// the container's own bytes are a zip and are never shown.
function readOffice(path) {
  try {
    const bytes = Buffer.from(officePreview(path).text);
    return { bytes: bytes.subarray(0, BYTE_LIMIT), truncated: bytes.length > BYTE_LIMIT, plain: true };
  } catch {
    return { state: "failed" };
  }
}

function readFile(path) {
  if (officeKind(path)) return readOffice(path);
  let fd;
  try {
    if (!statSync(path).isFile()) return { state: "failed" };
    fd = openSync(path, constants.O_RDONLY | (constants.O_NONBLOCK ?? 0));
    const st = fstatSync(fd);
    if (!st.isFile()) return { state: "failed" };
    const bytes = Buffer.alloc(Math.min(st.size, BYTE_LIMIT));
    const read = readSync(fd, bytes, 0, bytes.length, 0);
    return { bytes: bytes.subarray(0, read), truncated: st.size > BYTE_LIMIT };
  } catch {
    return { state: "failed" };
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

const plain = (line) => (line === "" ? [] : [0, line]);
const textOf = (runs) => runs.filter((_, i) => i % 2 === 1).join("");

// The coloured lines for a request, or null to answer plain. A text request is coloured through a
// temporary file named like the text, so jsmdcui picks the language from `name` or `lang`.
async function coloured(request, bytes, signal) {
  if (request.raw === true) return null;
  if (typeof request.text !== "string") {
    if (RENDERED.test(request.path ?? "")) return null;
    return highlightFile(request.path, signal, previewLanguage(request.path, bytes));
  }
  const name = request.lang ? `text.${request.lang}` : basename(request.name || "text.txt");
  if (RENDERED.test(name)) return null;
  const dir = mkdtempSync(join(tmpdir(), "flea-qml-code-"));
  try {
    writeFileSync(join(dir, name), bytes);
    return await highlightFile(join(dir, name), signal, previewLanguage(name, bytes));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// The line each RFC 4180 record starts on (0-based), for a raw `csv` table request: a quote opens
// only at a field's start, `""` is a quote inside quotes, and a line that ends inside quotes
// carries its record onto the next one. An unterminated quote runs to the end as one record.
function recordStarts(lines, delimiter) {
  const starts = [];
  let quoted = false;
  for (let index = 0; index < lines.length; index++) {
    if (!quoted) starts.push(index);
    const line = lines[index];
    let fieldStart = !quoted;
    for (let at = 0; at < line.length; at++) {
      const ch = line[at];
      if (quoted) {
        if (ch !== '"') continue;
        if (line[at + 1] === '"') at++;
        else quoted = false;
      } else if (ch === '"' && fieldStart) {
        quoted = true;
        fieldStart = false;
      } else fieldStart = ch === delimiter;
    }
  }
  return starts;
}

// The window of a raw `csv` request, as whole records (docs/protocol.md "code").
function recordWindow(all, request, count) {
  const starts = recordStarts(all, request.csv);
  const records = starts.length;
  // The record holding a line: the last start at or before it.
  const holding = (line) => {
    let low = 0, high = starts.length - 1;
    while (low < high) {
      const middle = (low + high + 1) >> 1;
      if (starts[middle] <= line) low = middle;
      else high = middle - 1;
    }
    return low;
  };
  let record;
  if (Number.isFinite(request.record)) {
    record = Math.max(1, Math.floor(request.record)) - 1;
    if (record >= records) return { from: all.length, to: all.length, records, firstRecord: record + 1 };
  } else {
    const line = Math.max(1, request.first ?? 1) - 1;
    if (line >= all.length) return { from: all.length, to: all.length, records, firstRecord: records + 1 };
    record = holding(line);
  }
  const from = starts[record];
  const last = holding(Math.min(all.length - 1, from + Math.max(1, count) - 1));
  const to = last + 1 < starts.length ? starts[last + 1] : all.length;
  return { from, to, records, firstRecord: record + 1 };
}

/** The reply to one `code` request; `signal` ends it when a newer request takes its slot. */
export async function code(request, signal) {
  const head = { t: "code", token: request.token ?? 0, slot: request.slot ?? "" };
  const source = typeof request.text === "string" ? { bytes: Buffer.from(request.text.slice(0,BYTE_LIMIT)).subarray(0,BYTE_LIMIT), truncated: Buffer.byteLength(request.text) > BYTE_LIMIT } : readFile(request.path ?? "");
  if (!source.bytes) return { ...head, state: source.state, first: request.first ?? 1, total: 0, lines: [] };
  const bytes = source.bytes;
  // Binary bytes remain viewable. Visible control pictures cannot execute terminal
  // escapes, and splitting pathological lines bounds each QML text layout.
  const decoded = bytes.toString("utf8");
  const binary = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(decoded);
  const safe = decoded.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, ch => ch === "\x7f" ? "␡" : String.fromCharCode(0x2400 + ch.charCodeAt(0)));
  let split = false;
  const all = [];
  for (let line of safe.split("\n")) {
    if (line.endsWith("\r")) line = line.slice(0,-1);
    while (line.length > 4096) { all.push(line.slice(0,4096));line=line.slice(4096);split=true; }
    all.push(line);
  }
  // A final newline ends the last line rather than starting another.
  if (all.length > 1 && all.at(-1) === "") all.pop();
  if (source.truncated) all.push("[Preview truncated: first 1 MiB]");
  if (split) all.push("[Long lines split for preview]");
  const total = bytes.length === 0 ? 0 : all.length;
  const first = Math.max(1, request.first ?? 1),
    count = Math.min(LINE_CAP, Math.max(0, request.count ?? LINE_CAP));
  if (request.raw === true && (request.csv === "," || request.csv === "\t")) {
    if (total === 0) return { ...head, state: "plain", first: 1, total, lines: [], records: 0, firstRecord: Math.max(1, Math.floor(request.record ?? 1) || 1) };
    const window = recordWindow(all, request, count);
    return { ...head, state: "plain", first: window.from + 1, total, lines: all.slice(window.from, window.to).map(plain), records: window.records, firstRecord: window.firstRecord };
  }
  const colours = source.truncated || source.plain || binary || split ? null : await coloured(request, bytes, signal);
  if (signal?.aborted) return null;
  let styled = false;
  const lines = all.slice(first - 1, first - 1 + count).map((line, i) => {
    const runs = colours?.[first - 1 + i];
    // A coloured line is used only when it holds exactly the file's own text.
    if (runs && textOf(runs) === line) {
      if (runs.some((value, at) => at % 2 === 0 && value !== 0)) styled = true;
      return runs;
    }
    return plain(line);
  });
  return { ...head, state: styled ? "styled" : "plain", first, total, lines };
}
