// The commands Find runs (find for names, grep for contents) and folder sizes run (du), which ui/Backend.qml spawns itself and reads as a stream; the backend only
// names it. Looked for the way src/highlight.js looks for jsmdcui: a bunmsh checkout beside this
// repository runs its entry with Bun, then a `bunmsh` on PATH is spawned as it is, and last the
// system's own `find`. Windows' find.exe searches text inside files and takes none of these
// arguments, so there it is never the fallback.
import { existsSync } from "node:fs";
import { join } from "node:path";

const BUN = Bun.which("bun") || process.argv0;
const REPO = join(import.meta.dir, "..");

let found;
/** The argv prefix a scope and its expression follow, or null when nothing can run Find. */
export function findCommand() {
  if (found !== undefined) return found;
  found = null;
  const beside = join(REPO, "..", "bunmsh", "index.js");
  if (existsSync(beside)) return (found = [BUN, beside, "-cc", "builtin", "find"]);
  const bunmsh = Bun.which("bunmsh");
  if (bunmsh) return (found = [bunmsh, "-cc", "builtin", "find"]);
  const system = process.platform === "win32" ? null : Bun.which("find");
  if (system) return (found = [system]);
  return found;
}

let grepFound;
/** The argv prefix a content search's options follow, or null when nothing can run grep. The
 * system's grep needs --line-buffered to stream into a pipe; Find always passes it. */
export function grepCommand() {
  if (grepFound !== undefined) return grepFound;
  grepFound = null;
  const beside = join(REPO, "..", "bunmsh", "index.js");
  if (existsSync(beside)) return (grepFound = [BUN, beside, "-cc", "builtin", "grep"]);
  const bunmsh = Bun.which("bunmsh");
  if (bunmsh) return (grepFound = [bunmsh, "-cc", "builtin", "grep"]);
  const system = process.platform === "win32" ? null : Bun.which("grep");
  if (system) return (grepFound = [system]);
  return grepFound;
}

let duFound;
/** The argv prefix a folder size's options follow (src/dirsize.js), found in Find's order: bunmsh
 * beside this repository, a `bunmsh` on PATH, then the system's own du. Windows' du, where one is
 * installed (Sysinternals), takes none of GNU's options, so there it is never the fallback. */
export function duCommand() {
  if (duFound !== undefined) return duFound;
  duFound = null;
  const beside = join(REPO, "..", "bunmsh", "index.js");
  if (existsSync(beside)) return (duFound = [BUN, beside, "-cc", "builtin", "du"]);
  const bunmsh = Bun.which("bunmsh");
  if (bunmsh) return (duFound = [bunmsh, "-cc", "builtin", "du"]);
  const system = process.platform === "win32" ? null : Bun.which("du");
  if (system) return (duFound = [system]);
  return duFound;
}
