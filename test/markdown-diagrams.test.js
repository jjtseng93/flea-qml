// Mermaid diagrams in the Markdown previews: fences held out of the page and drawn by src/figure.js
// (Pele in a Bun Worker), embedded as SVG pictures, and their source kept with a reason when not.
import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DIAGRAMS_PER_PAGE, drawDiagrams, holdFormulas, markdownHtml, markdownPage } from "../src/markdown-html.js";
import { figureTheme, renderDiagram, stopFigures } from "../src/figure.js";

const folder = mkdtempSync(join(tmpdir(), "flea-diagrams-"));
afterAll(() => { stopFigures(); rmSync(folder, { recursive: true, force: true }); });

const FLOW = "flowchart TD\n  A[開始 😀] --> B[結束]";
const pictures = (html) => [...html.matchAll(/<div class="diagram"><img alt="Mermaid diagram" src="data:image\/svg\+xml;base64,([^"]+)"><\/div>/g)]
  .map((match) => Buffer.from(match[1], "base64").toString());

test("Mermaid fences are held as the block view picks them, and other code stays code", () => {
  const source = [
    "```mermaid", "flowchart TD", "  A --> B", "```",
    "~~~ Mermaid title", "pie", "~~~",
    "  ```mermaid", "  sequenceDiagram", "    A->>B: hi", "  ```",
    "```js", "const x = 1;", "```",
    "```mermaid`", "not a fence opener", "```",
    "$x$ and `$y$`",
    "```mermaid", "flowchart LR", "  unclosed --> end",
  ].join("\n");
  const { text, diagrams, formulas } = holdFormulas(source);
  expect(diagrams).toEqual(["flowchart TD\n  A --> B", "pie", "sequenceDiagram\n  A->>B: hi", "flowchart LR\n  unclosed --> end"]);
  expect(text).toContain("```js\nconst x = 1;\n```");
  expect(text).not.toContain("flowchart");
  expect(formulas).toEqual([{ tex: "x", display: false }]);
});

test("a drawn diagram becomes a picture; a failed one keeps its source and says why", () => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><text>中文</text></svg>';
  const source = "# T\n\n```mermaid\nA\n```\n\n```mermaid\nB & <b>\n```\n\n```mermaid\nC\n```\n";
  const html = markdownPage(source, folder, {}, [{ svg }, { error: "Parse error <here>" }]);
  expect(pictures(html)).toEqual([svg]);
  expect(html).toContain("<pre><code>B &amp; &lt;b&gt;</code></pre><p class=\"diagram-error\">Diagram not drawn · Parse error &lt;here&gt;</p>");
  // A page built without drawing (no answer for the fence) shows the plain source.
  expect(html).toContain("<pre><code>C</code></pre>");
  expect(html).not.toMatch(/[]|<p><div|<script/);
});

test("diagrams share the pictures' budget", () => {
  const big = `<svg xmlns="http://www.w3.org/2000/svg">${"x".repeat((1 << 20) + 1)}</svg>`;
  const html = markdownPage("```mermaid\nA\n```\n", folder, {}, [{ svg: big }]);
  expect(pictures(html)).toEqual([]);
  expect(html).toContain("Diagram not drawn · over the page's picture budget");
});

test("the HTML preview draws Chinese and emoji labels, and the page stays passive", async () => {
  const path = join(folder, "doc.md");
  writeFileSync(path, `# 圖\n\n\`\`\`mermaid\n${FLOW}\n\`\`\`\n\n\`\`\`mermaid\nflowchart TD\n  A -->\n\`\`\`\n`);
  const answer = await markdownHtml({ path, token: 3, slot: "s", theme: { foreground: "#c0caf5", background: "#101315" } });
  expect(answer).toMatchObject({ t: "markdownhtml", token: 3, slot: "s", state: "ready" });
  const [svg] = pictures(answer.html);
  expect(svg).toContain("開始 😀");
  expect(svg).toContain("#c0caf5");
  expect(svg).not.toMatch(/<script|<foreignObject|\son\w+=/i);
  expect(answer.html).toMatch(/Diagram not drawn · Parse error on line 3: Expecting/);
  expect(answer.html).not.toMatch(/<script/i);
});

test(`at most ${DIAGRAMS_PER_PAGE} diagrams are drawn for one page`, async () => {
  const source = Array.from({ length: DIAGRAMS_PER_PAGE + 1 }, () => "```mermaid\nflowchart TD\n  A --> B\n```").join("\n\n");
  const drawn = await drawDiagrams(source);
  expect(drawn.slice(0, DIAGRAMS_PER_PAGE).every((answer) => answer.svg)).toBe(true);
  expect(drawn.at(-1)).toEqual({ error: `more than ${DIAGRAMS_PER_PAGE} diagrams on the page` });
});

test("renderDiagram caches, reports errors, and recovers from a deadline", async () => {
  const first = await renderDiagram(FLOW);
  expect(first.svg).toContain("結束");
  expect(await renderDiagram(FLOW)).toBe(first);
  expect((await renderDiagram("flowchart TD\n  A -->")).error).toMatch(/^Parse error on line 3: Expecting/);
  expect(await renderDiagram("  ")).toEqual({ error: "empty diagram" });
  expect(await renderDiagram("x".repeat(32769))).toEqual({ error: "diagram over 32 KiB" });
  const slow = "flowchart LR\n" + Array.from({ length: 300 }, (_, i) => `  N${i} --> N${(i * 7 + 3) % 300}`).join("\n");
  expect(await renderDiagram(slow, {}, { timeout: 1 })).toEqual({ error: "diagram took over 0.001 s" });
  // The stuck Worker was terminated; the next diagram starts a fresh one.
  expect((await renderDiagram("sequenceDiagram\n  甲->>乙: 你好")).svg).toContain("你好");
});

test("figureTheme keeps colours, a plain font name and whole advance tables, and dates a Gantt chart", () => {
  const advances = Array.from({ length: 95 }, () => 500);
  const theme = figureTheme({ fg: '"><script>', background: "#101315", font: "Noto Sans CJK TC", advances, boldAdvances: [1, 2] },
    "gantt\n  title 計畫", new Date(2026, 10, 15, 23));
  expect(theme).toMatchObject({ fg: "#d8dee9", bg: "#101315", font: "Noto Sans CJK TC", advances, boldAdvances: [] });
  expect(theme.today).toBe(Date.UTC(2026, 10, 15, 12));
  expect(figureTheme({ font: 'x" onload="y' }).font).toBe("sans-serif");
  expect(figureTheme({}, "flowchart TD").today).toBeUndefined();
});
