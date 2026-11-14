// bun test/bench-markdown-scroll.mjs [--steps=40] [--doc=readme,long,maths] [--mode=html,qml]
// Compares two ways to preview Markdown in buninu-browser's QML runtime, at 640x480:
//   html: Bun.markdown.html, formulas through src/mathml.js, shown by WebEngineView.loadHtml
//         (a sandboxed iframe the browser lays out once and scrolls itself);
//   qml:  ui/PreviewMarkdown.qml with the real backend (one delegate per block, built lazily).
// Each scroll step is one 120px wheel at the pane's centre followed by a 1x1 PNG capture,
// which waits for that frame's layout and paint; the times are wall clock, frame pacing
// excluded. No threshold is a test gate.
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { readdirSync, readFileSync, rmSync } from "node:fs";
import { createBrowser } from "../../buninu-browser/lib/headless-shell.js";
import { texToMathML } from "../src/mathml.js";

const repo = Bun.fileURLToPath(new URL("../", import.meta.url));
const option = (name, fallback) => process.argv.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const steps = Number(option("steps", 40));
const onlyDocs = option("doc", "readme,long,maths").split(",");
const modes = option("mode", "html,qml").split(",");

// ---- resource guard ----
// The browser's renderer, the QML document's flea backend and that backend's highlighter
// processes are all descendants of this process. A watchdog totals their memory every
// half second and kills the whole tree past the limits, and so does any exit, signal or
// stuck call: nothing this benchmark starts may outlive it or take the device down.
const RSS_LIMIT_MB = Number(option("rss-mb", 1200));
const PROCESS_LIMIT = Number(option("processes", 8));
const CALL_TIMEOUT_MS = 20000;
function descendants() {
  const children = new Map();
  for (const name of readdirSync("/proc")) {
    if (!/^\d+$/.test(name)) continue;
    try {
      const stat = readFileSync(`/proc/${name}/stat`, "utf8");
      // The command name is in parentheses and may hold spaces; the parent pid follows it.
      const parent = Number(stat.slice(stat.lastIndexOf(")") + 2).split(" ")[1]);
      if (!children.has(parent)) children.set(parent, []);
      children.get(parent).push(Number(name));
    } catch {}
  }
  const found = [], queue = [process.pid];
  while (queue.length) for (const child of children.get(queue.shift()) ?? []) { found.push(child); queue.push(child); }
  return found;
}
const rssMb = (pid) => {
  try { return Number(/VmRSS:\s+(\d+)/.exec(readFileSync(`/proc/${pid}/status`, "utf8"))?.[1] ?? 0) / 1024; } catch { return 0; }
};
function killTree(reason) {
  const pids = descendants();
  for (const pid of pids.reverse()) { try { process.kill(pid, "SIGKILL"); } catch {} }
  if (reason) console.error(`bench: stopped (${reason}); killed ${pids.length} process(es)`);
}
// Each process's memory and a short command line, so a report names what grew.
const commandOf = (pid) => {
  try { return readFileSync(`/proc/${pid}/cmdline`, "utf8").split("\0").filter(Boolean).map((part) => part.split("/").pop()).join(" ").slice(0, 70); } catch { return "?"; }
};
const breakdown = (pids) => [process.pid, ...pids].map((pid) => `${pid} ${Math.round(rssMb(pid))} MB ${commandOf(pid)}`).join("\n  ");
let samples = 0;
const watchdog = setInterval(() => {
  const pids = descendants();
  const total = pids.reduce((sum, pid) => sum + rssMb(pid), 0) + rssMb(process.pid);
  if (++samples % 4 === 0) console.error(`bench: memory ${Math.round(total)} MB in ${pids.length + 1} processes`);
  if (total > RSS_LIMIT_MB || pids.length > PROCESS_LIMIT) {
    console.error(`bench: over the limits:\n  ${breakdown(pids)}`);
    killTree(`${Math.round(total)} MB in ${pids.length + 1} processes, limits ${RSS_LIMIT_MB} MB / ${PROCESS_LIMIT}`);
    process.exit(2);
  }
}, 500);
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) process.on(signal, () => { killTree(signal); process.exit(130); });
// On any exit, also remove the wrapper documents this run wrote beside ui/boot/shell.qml.
process.on("exit", () => {
  killTree(null);
  try { for (const name of readdirSync(join(repo, "ui/boot"))) if (name.startsWith(".bench-")) rmSync(join(repo, "ui/boot", name), { force: true }); } catch {}
});
// Every browser call has a deadline; a renderer that stops answering ends the run.
const deadline = (promise, what) => Promise.race([promise, new Promise((_, reject) =>
  setTimeout(() => reject(new Error(`${what} took longer than ${CALL_TIMEOUT_MS} ms`)), CALL_TIMEOUT_MS).unref?.())]);
process.env.BUNINU_BUN = process.execPath;

// ---- documents ----
const words = (n, seed) => Array.from({ length: n }, (_, i) => ["preview", "markdown", "scroll", "layout", "flea", "text", "render", "paint", "block", "line"][(i * 7 + seed) % 10]).join(" ");
const readme = [
  "# Project title", "", words(40, 1), "",
  ...Array.from({ length: 12 }, (_, s) => [
    `## Section ${s + 1}`, "", words(60, s), "", `- ${words(8, s)}`, `- ${words(9, s + 1)}`, `- **bold** and *italic* and \`code\``, "",
    "```js", `const value${s} = ${s} * 2;`, "console.log(value" + s + ");", "```", "",
    "| a | b | c |", "|---|---|---|", `| ${s} | ${s * 2} | ${s * 3} |`, "| x | y | z |", "",
  ].join("\n")),
].join("\n");
const long = Array.from({ length: 600 }, (_, i) => (i % 25 === 0 ? `## Part ${i / 25 + 1}\n\n` : "") + `${i + 1}. ${words(30, i)}`).join("\n\n");
const maths = [
  "# Formulas", "",
  ...Array.from({ length: 60 }, (_, i) => [
    `Paragraph ${i + 1} has inline $x_${i % 9}^2 + \\frac{a}{b}$ and $\\sqrt{${i}}$ in it, ${words(20, i)}.`, "",
    i % 2 ? "$$\\sum_{k=1}^{n} k^2 = \\frac{n(n+1)(2n+1)}{6}$$" : "$$\\begin{pmatrix}a & b \\\\ c & d\\end{pmatrix} \\int_0^1 x\\,dx$$", "",
    i % 5 === 0 ? "| n | n² |\n|---|---|\n| 1 | 1 |\n| 2 | 4 |\n" : "",
  ].join("\n")),
].join("\n");
const documents = { readme, long, maths };
// --md=path adds one document of your own, run alone.
const own = option("md", "");
if (own) { for (const key of Object.keys(documents)) delete documents[key]; documents[own.split("/").pop().replace(/\.md$/, "")] = readFileSync(own, "utf8"); onlyDocs.push(own.split("/").pop().replace(/\.md$/, "")); }

// ---- the HTML variant ----
// Formulas are set aside before Markdown runs, so its emphasis rules never touch TeX. The
// markers are private-use characters: Markdown replaces NUL with U+FFFD, so NUL would not survive.
function markdownHtml(source) {
  const formulas = [];
  const hold = (tex, display) => `\uE000${formulas.push({ tex, display }) - 1}\uE001`;
  const marked = source
    .replace(/\$\$([\s\S]+?)\$\$/g, (_, tex) => hold(tex, true))
    .replace(/\$([^$\n]+?)\$/g, (_, tex) => hold(tex, false));
  const html = Bun.markdown.html(marked, { tables: true, strikethrough: true, tasklists: true, noHtmlBlocks: true, noHtmlSpans: true });
  return html.replace(/\uE000(\d+)\uE001/g, (_, index) => {
    const { tex, display } = formulas[Number(index)];
    try { return texToMathML(tex, display); } catch { return `<code>${Bun.escapeHTML(tex)}</code>`; }
  });
}
const STYLE = "body{margin:12px 16px;font:14px sans-serif;color:#d8dee9;background:#171b22;line-height:1.45}" +
  "pre,code{background:#232833;font-family:monospace}pre{padding:8px 12px}table{border-collapse:collapse}" +
  "td,th{border:1px solid #444;padding:2px 8px}h1{font-size:20px}h2{font-size:16px}math[display=block]{margin:6px 0}";

// ---- measuring ----
async function measure(browser, qmlPath, ready) {
  const started = performance.now();
  const context = browser.context;
  // The QML host keeps its global object across documents: clear what the last one set.
  await deadline(context.evaluate(`globalThis.benchReady = null; globalThis.preview = null; true`), "evaluate").catch(() => {});
  await deadline(context.navigate(Bun.pathToFileURL(qmlPath).href), "navigate");
  let isReady = false;
  for (let i = 0; i < 400 && !(isReady = await deadline(context.evaluate(ready), "evaluate")); i++) await Bun.sleep(50);
  if (!isReady) throw new Error("the preview never became ready");
  await deadline(context.screenshot({ format: "png", clip: { x: 0, y: 0, width: 1, height: 1, scale: 1 } }), "screenshot");
  const openMs = performance.now() - started;
  const hash = async () => Bun.hash(await deadline(context.screenshot({ format: "png", clip: { x: 200, y: 140, width: 240, height: 200, scale: 1 } }), "screenshot")).toString();
  const before = await hash();
  const times = [];
  for (let step = 0; step < steps; step++) {
    const begin = performance.now();
    await deadline(context.scroll(0, 120, { x: 320, y: 240 }), "scroll");
    await deadline(context.screenshot({ format: "png", clip: { x: 0, y: 0, width: 1, height: 1, scale: 1 } }), "screenshot");
    times.push(performance.now() - begin);
  }
  const moved = (await hash()) !== before;
  const sorted = [...times].sort((a, b) => a - b);
  const at = (q) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
  return { openMs: Math.round(openMs), medianMs: +at(0.5).toFixed(1), p95Ms: +at(0.95).toFixed(1), maxMs: +sorted.at(-1).toFixed(1), moved };
}

const dir = await mkdtemp(join(tmpdir(), "flea-md-bench-"));
const browser = await createBrowser({ spareRenderer: false });
const results = [];
try {
  await browser.context.resize(640, 480, 1);
  const report = (result) => { results.push(result); console.log("RESULT " + JSON.stringify(result)); };
  for (const [name, source] of Object.entries(documents)) {
    if (!onlyDocs.includes(name)) continue;
    const md = join(dir, `${name}.md`);
    await Bun.write(md, source);
    if (modes.includes("html")) {
    // html: the page is built here, as the backend would build it.
    const buildStart = performance.now();
    const html = `<!doctype html><meta charset=utf-8><style>${STYLE}</style>${markdownHtml(source)}`;
    const buildMs = Math.round(performance.now() - buildStart);
    const htmlQml = join(repo, `ui/boot/.bench-html-${process.pid}.qml`);
    await Bun.write(htmlQml, `import QtQuick\nimport Quickshell\nimport QtWebEngine\nFloatingWindow {width:640;height:480;color:"#171b22"\n WebEngineView {anchors.fill:parent;settings.javascriptEnabled:false\n  onLoadingChanged:function(info){if(info.status===WebEngineView.LoadSucceededStatus)globalThis.benchReady=${JSON.stringify(name)}}\n  Component.onCompleted:loadHtml(${JSON.stringify(html)})}}`);
    // Each document answers its own name, so a flag left by the previous one never counts.
    const htmlResult = await measure(browser, htmlQml, `globalThis.benchReady===${JSON.stringify(name)}`);
    await rm(htmlQml, { force: true });
    report({ document: name, mode: "html (iframe)", bytes: source.length, buildMs, ...htmlResult });
    }
    if (modes.includes("qml")) {
    // qml: the existing preview, with its own backend reading the file.
    const qmlQml = join(repo, `ui/boot/.bench-qml-${process.pid}.qml`);
    await Bun.write(qmlQml, `import QtQuick\nimport Quickshell\nimport ".." as Flea\nFloatingWindow {width:640;height:480;color:"#171b22";Flea.Backend{id:backend}\n Loader {anchors.fill:parent;Component.onCompleted:setSource("${Bun.pathToFileURL(join(repo, "ui/PreviewMarkdown.qml")).href}")\n  onLoaded:{item.backend=backend;item.size=${Buffer.byteLength(source)};item.path=${JSON.stringify(md)};item.active=true;globalThis.preview=item}}}`);
    const qmlResult = await measure(browser, qmlQml, "!!globalThis.preview && preview.loadedText.length>0 && preview.viewport.count>0");
    await rm(qmlQml, { force: true });
    report({ document: name, mode: "qml (rich text blocks)", bytes: source.length, buildMs: 0, ...qmlResult });
    }
  }
} finally {
  clearInterval(watchdog);
  await deadline(browser.close(), "close").catch(() => {});
  killTree(null);
  await rm(dir, { recursive: true, force: true });
  for (const name of readdirSync(join(repo, "ui/boot"))) if (name.startsWith(".bench-")) await rm(join(repo, "ui/boot", name), { force: true });
}
console.table(results);
console.log(JSON.stringify(results));
