// The `changed` line: a watched directory changed under another program (docs/protocol.md
// "changed"). Upstream uses inotify directly; node:fs watch is inotify on Linux and
// ReadDirectoryChangesW on Windows, so one module serves every platform.
//
// Two sets, as upstream keeps them apart: the listed directory, and the columns' directories a
// watching `peek` names in `keep`. A burst is one line: after a line, a directory waits 100 ms
// before it can send another.
import { watch } from "node:fs";
import { resolve } from "node:path";

const QUIET = 100,
  COLUMN_GUARD = 8;

let send = () => {};
export function onChanged(sender) {
  send = sender;
}

function arm(path) {
  let timer = null,
    pending = false;
  const fire = () => {
    if (timer) {
      pending = true;
      return;
    }
    send({ t: "changed", path });
    timer = setTimeout(() => {
      timer = null;
      if (pending) {
        pending = false;
        fire();
      }
    }, QUIET);
    timer.unref?.();
  };
  let watcher;
  try {
    watcher = watch(path || ".", { persistent: false }, fire);
  } catch (e) {
    console.error(`flea-qml backend: cannot watch ${path}: ${e.message}`);
    return null;
  }
  // A watched directory deleted or unmounted ends its watch after its last line.
  watcher.on("error", () => {
    fire();
    watcher.close();
  });
  return {
    close() {
      clearTimeout(timer);
      watcher.close();
    },
  };
}

// ---- the listed directory ----

let listed = null;

// Armed before the read, beside the current watch, so a change during the read is reported and a
// failed list leaves the old watch standing. Returns what `listDone` or `listFailed` settles.
export function watchList(path) {
  return { path, watch: listed && resolve(listed.path || ".") === resolve(path || ".") ? null : arm(path) };
}
export function listDone(armed) {
  if (!armed.watch) return;
  listed?.watch.close();
  listed = armed;
}
export function listFailed(armed) {
  armed.watch?.close();
}

// ---- the columns ----

const columns = new Map();

export function watchColumn(path, keep) {
  const kept = new Set((Array.isArray(keep) ? keep : [path]).map((p) => resolve(String(p))));
  kept.add(resolve(path));
  for (const [key, watcher] of columns)
    if (!kept.has(key)) {
      watcher.close();
      columns.delete(key);
    }
  const key = resolve(path);
  if (!columns.has(key)) {
    const watcher = arm(path);
    if (watcher) columns.set(key, watcher);
  }
  // A client that sends no keep keeps at most eight, the oldest dropped first.
  while (columns.size > COLUMN_GUARD) {
    const [oldest, watcher] = columns.entries().next().value;
    watcher.close();
    columns.delete(oldest);
  }
}
