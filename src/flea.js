// flea-qml's `flea`: the one program ui/ runs for everything it asks of the outside, through
// ui/js/FleaBin.js as `bun src/flea.js ARGS`. Upstream's equivalent is the `flea` binary's
// src/main.rs, whose other modes (--open, --run, --favourites, ...) are not ported yet.
import { runBackend } from "./backend.js";
import { readState, updateState } from "./uistore.js";
import { render } from "./uistate.js";

const args = process.argv.slice(2);

// --ui-state prints the settled document; --ui-state PATCH merges one JSON object under the lock
// and prints the result. Every refusal is one "flea: " sentence on stderr, nothing on stdout, exit 2.
function uiState(rest) {
  try {
    if (rest.length > 1) throw new Error("--ui-state takes nothing, or one JSON object");
    if (rest.length === 0) {
      process.stdout.write(render(readState()));
      return 0;
    }
    let patch;
    try {
      patch = JSON.parse(rest[0]);
    } catch (error) {
      throw new Error(`the ui.json patch is not JSON (${error.message})`);
    }
    process.stdout.write(render(updateState(patch)));
    return 0;
  } catch (error) {
    process.stderr.write(`flea: ${error.message}\n`);
    return 2;
  }
}

const [mode, ...rest] = args;
if (mode === "--backend") runBackend();
else if (mode === "--ui-state") process.exit(uiState(rest));
else {
  console.error(`flea-qml: not implemented yet: ${args.join(" ") || "(no arguments)"}`);
  process.exit(1);
}
