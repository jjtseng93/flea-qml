// The `code` line: a window of a file's or a text's lines for the preview (docs/protocol.md
// "code"). Lines are coloured by jsmdcui when it can be found (src/highlight.js) and answered
// plain otherwise. Upstream: src/backend/code.rs, which runs `bat`.
// Not done yet: jq formatting of one-line JSON, raw CSV record windows.
import { closeSync, fstatSync, mkdtempSync, openSync, readSync, rmSync, statSync, writeFileSync, constants } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { highlightFile } from "./highlight.js";
import { previewLanguage } from "./preview-language.js";

// Bound IO and layout work: large files show their prefix, never a refusal.
const BYTE_LIMIT = 1 << 20;
// One reply carries at most this many lines; ui/CodeLines.qml asks a longer window in parts.
const LINE_CAP = 400;
// jsmdcui renders Markdown as a document rather than colouring its source, so its lines would not
// be the file's; Markdown is answered plain.
const RENDERED = /\.(md|markdown|mkd)$/i;

function readFile(path) {
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
  const colours = source.truncated || binary || split ? null : await coloured(request, bytes, signal);
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
