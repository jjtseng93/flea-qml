// The diagram Worker (src/figure.js starts it): Pele parses and lays out here, off the backend's
// own thread, so a slow layout never holds a listing, and a stuck one can be terminated.
// Requests are {id, source, theme}; answers are {id, svg} or {id, error}.
import { renderFigure } from "./figure-svg.js";

// An error's words on one bounded line, as the preview shows it under the diagram's source: a
// parse error's position, then what was expected; the caret line pointing at it is left out.
const ERROR_CHARS = 160;
const reasonOf = (error) => String(error?.message ?? error).split("\n")
  .filter((line) => line.trim() && !/^[\s^~-]*$/.test(line)).join(" ").replace(/\s+/g, " ").slice(0, ERROR_CHARS) || "render failed";

// Load the wrapper and official Pele module on the first diagram, not at start.
let api = null;

self.onmessage = async ({ data }) => {
  const { id, source, theme } = data;
  try {
    api ??= await import("./pele-wrapper.js");
    postMessage({ id, svg: await renderFigure("mermaid", String(source), true, theme, api) });
  } catch (error) {
    postMessage({ id, error: reasonOf(error) });
  }
};
