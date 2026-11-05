// Where ui.json lives and the one way it is rewritten: the lock, the re-read, the temp and the
// rename (docs/architecture "The state file" upstream). Upstream: src/uistore.rs.
//
// Upstream locks with flock(2), which neither Bun nor Windows offers. Here the lock is a file
// created exclusively that names its holder; one whose holder is gone, or that is older than any
// update takes, is stale and taken over. It has its own name, so it never meets the ui.json.lock
// upstream's binary leaves behind when the two share a state directory.
import { closeSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, unlinkSync, writeSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { defaults, fromFile, fromViewJson, isUiDocument, patched, render } from "./uistate.js";

const STATE_NOT_WRITTEN = "the state file was not written";
const LOCK_STALE_MS = 30_000,
  LOCK_WAIT_MS = 10_000;

const envDir = (name) => (process.env[name] ? process.env[name] : null);

export function storePaths() {
  const home = process.env.HOME || homedir();
  const state = envDir("XDG_STATE_HOME") ?? join(home, ".local", "state");
  const config = envDir("XDG_CONFIG_HOME") ?? join(home, ".config");
  return {
    file: join(state, "flea", "ui.json"),
    lock: join(state, "flea", "ui.json.flea-qml.lock"),
    legacy: join(config, "flea", "view.json"),
  };
}

const kind = (path) => {
  try {
    return lstatSync(path);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw new Error(`${path} could not be inspected (${error.code}), so ${STATE_NOT_WRITTEN}`);
  }
};

// A link, a device or an unreadable file is refused, never renamed over.
function readTarget(path) {
  const st = kind(path);
  if (!st) return null;
  if (st.isSymbolicLink()) throw new Error(`${path} is a symbolic link, so ${STATE_NOT_WRITTEN}`);
  if (!st.isFile()) throw new Error(`${path} is not a regular file, so ${STATE_NOT_WRITTEN}`);
  try {
    return readFileSync(path, "utf8");
  } catch {
    throw new Error(`${path} could not be read, so ${STATE_NOT_WRITTEN}`);
  }
}

/** Never fails, so a front end can read it before first paint. */
export function readState(paths = storePaths()) {
  let text;
  try {
    text = readFileSync(paths.file, "utf8");
  } catch {}
  if (text !== undefined) {
    let doc;
    try {
      doc = JSON.parse(text);
    } catch {}
    return isUiDocument(doc) ? fromFile(text) : defaults();
  }
  // A ui.json that is there is the state file even unreadable; view.json only while there is none.
  if (kind(paths.file)) return defaults();
  try {
    return fromViewJson(readFileSync(paths.legacy, "utf8"));
  } catch {
    return defaults();
  }
}

const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
};

function takeLock(path) {
  const deadline = Date.now() + LOCK_WAIT_MS;
  for (;;) {
    try {
      const fd = openSync(path, "wx", 0o600);
      writeSync(fd, JSON.stringify({ pid: process.pid, at: Date.now() }));
      closeSync(fd);
      return;
    } catch (error) {
      if (error.code !== "EEXIST") throw new Error(`${path} could not be opened as the ui.json lock (${error.code})`);
    }
    // A lock just created may not name its holder yet; until it does, only its age can make it stale.
    let holder = null, age = 0;
    try {
      age = Date.now() - lstatSync(path).mtimeMs;
      holder = JSON.parse(readFileSync(path, "utf8"));
    } catch {}
    const stale = age > LOCK_STALE_MS
      || (Number.isInteger(holder?.pid) && !alive(holder.pid));
    if (stale) {
      rmSync(path, { force: true });
      continue;
    }
    if (Date.now() > deadline) throw new Error(`${path} is held by process ${holder.pid}, so ${STATE_NOT_WRITTEN}`);
    sleep(10);
  }
}

// Create this process's own temp exclusively, sync it, and rename it over the file last.
function replace(path, text) {
  const tmp = `${path}.${process.pid}.tmp`;
  rmSync(tmp, { force: true });
  try {
    const fd = openSync(tmp, "wx", 0o600);
    try {
      writeSync(fd, text);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(tmp, path);
  } catch (error) {
    rmSync(tmp, { force: true });
    throw new Error(`${path} could not be written (${error.code ?? error.message})`);
  }
}

// A file that is not a JSON object is kept as ui.json.broken and replaced; a foreign or newer one is refused.
function write(paths, state) {
  const text = readTarget(paths.file);
  if (text !== null) {
    let doc;
    try {
      doc = JSON.parse(text);
    } catch {}
    if (doc !== null && typeof doc === "object" && !Array.isArray(doc)) {
      if (!isUiDocument(doc))
        throw new Error(`${paths.file}: foreign or newer-schema document; file was left unchanged, so ${STATE_NOT_WRITTEN}`);
    } else {
      const backup = join(dirname(paths.file), "ui.json.broken");
      readTarget(backup);
      replace(backup, text);
    }
  }
  replace(paths.file, render(state));
}

/** Merges one caller patch under the lock and returns the document now on disk. */
export function updateState(patch, paths = storePaths()) {
  try {
    mkdirSync(dirname(paths.file), { recursive: true, mode: 0o700 });
  } catch (error) {
    throw new Error(`${dirname(paths.file)} could not be created (${error.code})`);
  }
  takeLock(paths.lock);
  try {
    const next = patched(readState(paths), patch);
    write(paths, next);
    return next;
  } finally {
    try {
      unlinkSync(paths.lock);
    } catch {}
  }
}
