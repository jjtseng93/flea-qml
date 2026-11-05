// The `code` line: a window of a file's or a text's lines for the preview (docs/protocol.md
// "code"). Upstream colours them with `bat`; nothing is run here, so every line comes back plain,
// one run in the foreground role. Upstream: src/backend/code.rs.
// Not done yet: syntax colours, jq formatting of one-line JSON, raw CSV record windows.
import { closeSync, fstatSync, openSync, readSync, statSync, constants } from "node:fs";

// Only this much of a file is ever read; a bigger one answers "large".
const BYTE_LIMIT = 1 << 20;
// One reply carries at most this many lines; ui/CodeLines.qml asks a longer window in parts.
const LINE_CAP = 400;

function readFile(path) {
  let fd;
  try {
    if (!statSync(path).isFile()) return { state: "failed" };
    fd = openSync(path, constants.O_RDONLY | (constants.O_NONBLOCK ?? 0));
    const st = fstatSync(fd);
    if (!st.isFile()) return { state: "failed" };
    if (st.size > BYTE_LIMIT) return { state: "large" };
    const bytes = Buffer.alloc(st.size);
    const read = readSync(fd, bytes, 0, bytes.length, 0);
    return { bytes: bytes.subarray(0, read) };
  } catch {
    return { state: "failed" };
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

export function code(request) {
  const head = { t: "code", token: request.token ?? 0, slot: request.slot ?? "" };
  const source = typeof request.text === "string" ? { bytes: Buffer.from(request.text) } : readFile(request.path ?? "");
  if (!source.bytes) return { ...head, state: source.state, first: request.first ?? 1, total: 0, lines: [] };
  const bytes = source.bytes;
  // A NUL in the first 1 KiB makes it binary, which is shown as such rather than as text.
  if (bytes.subarray(0, 1024).includes(0)) return { ...head, state: "binary", first: request.first ?? 1, total: 0, lines: [] };
  const all = bytes.toString("utf8").split("\n");
  // A final newline ends the last line rather than starting another.
  if (all.length > 1 && all.at(-1) === "") all.pop();
  const total = bytes.length === 0 ? 0 : all.length;
  const first = Math.max(1, request.first ?? 1),
    count = Math.min(LINE_CAP, Math.max(0, request.count ?? LINE_CAP));
  const lines = all.slice(first - 1, first - 1 + count).map((line) => {
    const text = line.endsWith("\r") ? line.slice(0, -1) : line;
    return text === "" ? [] : [0, text];
  });
  return { ...head, state: "plain", first, total, lines };
}
