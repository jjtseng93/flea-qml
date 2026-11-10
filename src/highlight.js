// Syntax colours for `code` lines, from jsmdcui's `--cat --edit FILE`, whose truecolor ANSI output
// is read back into the protocol's roles: 0 the foreground, then red, green, yellow, blue, magenta
// and cyan (docs/protocol.md "code"). Upstream runs `bat` for the same lines.
// jsmdcui is looked for beside this repository first, then as `jmi` or `jsmdcui` on PATH, and its
// a sibling checkout runs with Bun while PATH commands keep their own launcher semantics.
import { existsSync } from "node:fs";
import { join } from "node:path";

const BUN = Bun.which("bun") || process.argv0;
const REPO = join(import.meta.dir, "..");

let found;
/** The command argv prefix, or null when none can be found. Looked up once per process. */
export function jsmdcui() {
  if (found !== undefined) return found;
  found = null;
  const beside = join(REPO, "..", "jsmdcui", "src", "index.js");
  if (existsSync(beside)) return (found = [BUN, beside]);
  for (const name of ["jmi", "jsmdcui"]) {
    const command = Bun.which(name);
    if (command) return (found = [command]);
  }
  return found;
}

// The six ANSI hues the roles name, as angles on the colour wheel.
const HUES = [[1, 0], [3, 60], [2, 120], [6, 180], [4, 240], [5, 300]];
const BASIC = { 1: 1, 2: 2, 3: 3, 4: 4, 5: 5, 6: 6 };

// The role nearest a 24-bit colour; greys and near-greys are the foreground.
function roleOfRgb(r, g, b) {
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  if (max === 0 || (max - min) / max < 0.25) return 0;
  const d = max - min;
  let hue = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  hue = (hue * 60 + 360) % 360;
  let best = 0, distance = Infinity;
  for (const [role, angle] of HUES) {
    const off = Math.min(Math.abs(hue - angle), 360 - Math.abs(hue - angle));
    if (off < distance) [best, distance] = [role, off];
  }
  return best;
}

// xterm's 256 colours: the cube and the greys, by their RGB, and the first sixteen by name.
function roleOf256(n) {
  if (n < 16) return BASIC[n % 8] ?? 0;
  if (n >= 232) return 0;
  const i = n - 16, level = (v) => (v === 0 ? 0 : 55 + v * 40);
  return roleOfRgb(level(Math.floor(i / 36)), level(Math.floor(i / 6) % 6), level(i % 6));
}

/** One line of ANSI text as a flat run list [role, text, role, text, ...]; [] when empty. */
export function runsOf(line) {
  const runs = [];
  let role = 0;
  const push = (text) => {
    if (!text) return;
    if (runs.length && runs[runs.length - 2] === role) runs[runs.length - 1] += text;
    else runs.push(role, text);
  };
  const pattern = /\x1b\[([0-9;]*)m/g;
  let at = 0;
  for (let m; (m = pattern.exec(line)); at = pattern.lastIndex) {
    push(line.slice(at, m.index));
    const codes = m[1] === "" ? [0] : m[1].split(";").map(Number);
    for (let i = 0; i < codes.length; i++) {
      const c = codes[i];
      if (c === 0 || c === 39) role = 0;
      else if (c >= 30 && c <= 37) role = BASIC[c - 30] ?? 0;
      else if (c >= 90 && c <= 97) role = BASIC[c - 90] ?? 0;
      else if (c === 38 && codes[i + 1] === 2) {
        role = roleOfRgb(codes[i + 2], codes[i + 3], codes[i + 4]);
        i += 4;
      } else if (c === 38 && codes[i + 1] === 5) {
        role = roleOf256(codes[i + 2]);
        i += 2;
      } else if (c === 48 && codes[i + 1] === 2) i += 4;
      else if (c === 48 && codes[i + 1] === 5) i += 2;
    }
  }
  push(line.slice(at));
  return runs;
}

/**
 * The coloured lines of `path` as run lists, or null when jsmdcui is missing, fails or is
 * cancelled through `signal`. Every line of the file is returned; the caller takes its window.
 */
export async function highlightFile(path, signal, filetype = null) {
  const command = jsmdcui();
  if (!command) return null;
  try {
    const args = [...command, "--cat", "--edit"];
    // jsmdcui settings use one dash: --filetype would name a different setting.
    if (filetype) args.push("-filetype", filetype);
    args.push(path);
    const child = Bun.spawn(args, { stdout: "pipe", stderr: "ignore", stdin: "ignore", signal });
    const [text, code] = await Promise.all([new Response(child.stdout).text(), child.exited]);
    if (code !== 0 || signal?.aborted) return null;
    return text.split("\n").map(runsOf);
  } catch {
    return null;
  }
}
