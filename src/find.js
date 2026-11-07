// The command Find runs, which ui/Backend.qml spawns itself and reads as a stream; the backend only
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
