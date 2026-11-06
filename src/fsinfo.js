// The `fsinfo` line: the listed directory's filesystem name and free bytes
// (docs/protocol.md "fsinfo"). Upstream: src/backend/fsinfo.rs.
import { readFileSync, statSync, statfsSync } from "node:fs";

// Kernel dev_t, as glibc's major() and minor() split it.
const majorOf = (dev) => Number(((dev >> 8n) & 0xfffn) | ((dev >> 32n) & ~0xfffn));
const minorOf = (dev) => Number((dev & 0xffn) | ((dev >> 12n) & ~0xffn));

// The mount holding a device id, by its "major:minor" in /proc/self/mountinfo. Linux only:
// elsewhere the name stays empty, which the status bar draws as no filesystem name.
export function fsTypeOf(dev) {
  if (process.platform !== "linux") return "";
  let text = "";
  try {
    text = readFileSync("/proc/self/mountinfo", "utf8");
  } catch {
    return "";
  }
  const id = `${majorOf(dev)}:${minorOf(dev)}`;
  for (const line of text.split("\n")) {
    const fields = line.split(" ");
    if (fields[2] !== id) continue;
    const separator = fields.indexOf("-");
    if (separator > 0) return fields[separator + 1] ?? "";
  }
  return "";
}

// statfs exists on Linux, macOS and Windows in Node; a runtime without it lands in the catch.
export function fsinfo(path) {
  try {
    const dev = statSync(path || ".", { bigint: true }).dev,
      fs = statfsSync(path || ".");
    return { t: "fsinfo", fs: fsTypeOf(dev), free: fs.bavail * fs.bsize, path, class: "", tagable: false };
  } catch {
    // An unreadable path answers an empty fs with a free of 0 rather than a wrong number.
    return { t: "fsinfo", fs: "", free: 0, path, class: "", tagable: false };
  }
}
