// flea-qml's `flea`: the one program ui/ runs for everything it asks of the outside, through
// ui/js/FleaBin.js as `bun src/flea.js ARGS`. Upstream's equivalent is the `flea` binary's
// src/main.rs, whose other modes (--ui-state, --open, --run, ...) are not ported yet.
import { runBackend } from "./backend.js";

const [mode] = process.argv.slice(2);
if (mode === "--backend") runBackend();
else {
  console.error(`flea-qml: not implemented yet: ${process.argv.slice(2).join(" ") || "(no arguments)"}`);
  process.exit(1);
}
