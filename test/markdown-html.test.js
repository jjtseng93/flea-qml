import { test, expect, afterAll } from "bun:test";
import { mkdtempSync, writeFileSync, mkdirSync, symlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { markdownPage, cleanHtml, holdFormulas, linkAllowed, pageStyle, markdownHtml, MARKDOWN_LIMIT } from "../src/markdown-html.js";

const root = mkdtempSync(join(tmpdir(), "flea-md-html-"));
const docs = join(root, "docs");
mkdirSync(docs);
// A 1x1 PNG.
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
writeFileSync(join(docs, "pic.png"), PNG);
writeFileSync(join(root, "secret.png"), PNG);
symlinkSync(join(root, "secret.png"), join(docs, "link.png"));
afterAll(() => rmSync(root, { recursive: true, force: true }));
const body = (markdown) => markdownPage(markdown, docs).replace(/^[\s\S]*?<\/style>/, "");

test("Markdown becomes headings, lists, tables, code and task boxes", () => {
  const html = body("# Title\n\n- **bold** and *it*\n- `code`\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n```js\nlet x = 1 < 2;\n```\n\n- [x] done\n- [ ] todo\n");
  expect(html).toContain("<h1>Title</h1>");
  expect(html).toContain("<strong>bold</strong>");
  expect(html).toContain("<table>");
  expect(html).toContain("let x = 1 &lt; 2;");
  expect(html).toContain('<input checked type="checkbox" disabled>');
  expect(html).not.toMatch(/<script|<style(?![^]*<\/style>[^]*$)/);
});

test("TeX in $…$ and $$…$$ and raw MathML become formulas; code and prices stay text", () => {
  const html = body("Inline $x^2$ and\n\n$$\\frac{a}{b}$$\n\n<math><mi>y</mi></math>\n\n`$not$` costs $5 and $10\n\n```\n$also not$\n```\n");
  expect((html.match(/<math/g) ?? []).length).toBe(3);
  expect(html).toContain('<math display="block">');
  expect(html).toContain("<code>$not$</code>");
  expect(html).toContain("costs $5 and $10");
  expect(html).toContain("$also not$");
});

test("a formula that fails is shown as its source, escaped", () => {
  const html = body("Bad $\\frac{1}{$ and <math><mi title=x>a</mi></math>");
  expect(html).toContain('<code class="formula-source">$\\frac{1}{$</code>');
  expect(html).toContain("&lt;math&gt;&lt;mi title=x&gt;a&lt;/mi&gt;&lt;/math&gt;");
});

test("active content, raw-text elements and foreign markup never survive", () => {
  const attacks = [
    "<script>alert(1)</script>", "<style>body{background:url(http://x)}</style>", "<iframe src=x></iframe>",
    "<textarea><img src=x onerror=alert(1)></textarea>", "<title><script>alert(1)</script></title>",
    "<svg><script>alert(1)</script></svg>", "<object data=x></object>", "<embed src=x>",
    "<noscript><img src=x onerror=alert(1)></noscript>", "<xmp><img src=x onerror=alert(1)></xmp>",
  ];
  for (const attack of attacks) {
    const html = body(`before\n\n${attack}\n\nafter`);
    expect(html).not.toMatch(/<(script|style|iframe|object|embed|svg|img|textarea|title|xmp|noscript)[\s>]/i);
    expect(html).toContain("after");
  }
});

test("only the allowed attributes stay; links keep http, https, mailto and relative targets", () => {
  const html = body('<p align="center" onclick="alert(1)" style="color:red" class="c" id="i">x</p>\n\n' +
    '[ok](https://example.com) [mail](mailto:a@b.c) [rel](other.md) [js](javascript:alert(1)) <a href="jav&#x61;script:alert(1)">e</a> <a href="data:text/html,x">d</a>');
  expect(html).toContain('<p align="center">x</p>');
  expect(html).not.toMatch(/onclick|style=|class="c"|id="i"/);
  expect(html).toContain('href="https://example.com"');
  expect(html).toContain('href="mailto:a@b.c"');
  expect(html).toContain('href="other.md"');
  expect(html).not.toMatch(/javascript|jav&|data:text/i);
  for (const [target, allowed] of [["https://x", true], ["#top", true], ["a/b.md", true], ["JaVaScRiPt:x", false],
    ["java\tscript:x", false], ["%6Aavascript:x", false], ["vbscript:x", false], ["file:///etc/passwd", false]])
    expect(linkAllowed(target)).toBe(allowed);
});

test("pictures: inside the folder embedded, remote ones named, escapes dropped", () => {
  const html = body("![a](pic.png) ![r](https://img.shields.io/badge/x.svg) ![up](../secret.png) ![abs](/etc/passwd.png) ![ln](link.png) ![d](data:image/png;base64,AAAA)");
  expect(html).toMatch(/<img alt="a" src="data:image\/png;base64,[A-Za-z0-9+/=]+">/);
  expect(html).toContain('<span class="remote">Remote image not loaded · img.shields.io</span>');
  // Outside the folder (by .., by absolute path or through a symbolic link) and data: are not loaded.
  expect((html.match(/<img/g) ?? []).length).toBe(1);
  for (const alt of ["up", "abs", "ln", "d"]) expect(html).toContain(`<span class="alt">${alt}</span>`);
});

test("the theme only accepts #rrggbb colours", () => {
  const style = pageStyle({ foreground: "red;}</style><script>alert(1)</script>", background: "#101010", bodyPx: "99" });
  expect(style).not.toContain("script");
  expect(style).toContain("background:#101010");
  expect(style).toContain("font:40px");
});

test("formula markers in the source are neutralised and text never becomes markup", () => {
  const { text, formulas } = holdFormulas("0 and $x$");
  expect(formulas.length).toBe(1);
  expect(text.startsWith("�0�")).toBe(true);
  expect(cleanHtml("<p>a &lt;b&gt; c</p>", docs)).toBe("<p>a &lt;b&gt; c</p>");
});

test("the backend answer reads the file and refuses one over the limit", async () => {
  const path = join(docs, "note.md");
  writeFileSync(path, "# Note\n\n$x$\n");
  const ready = await markdownHtml({ path, slot: "look", token: 3, theme: {} });
  expect(ready).toMatchObject({ t: "markdownhtml", slot: "look", token: 3, state: "ready" });
  expect(ready.html.startsWith("<!doctype html>")).toBe(true);
  expect(ready.html).toContain("<math>");
  const big = join(docs, "big.md");
  writeFileSync(big, "x".repeat(MARKDOWN_LIMIT + 1));
  expect((await markdownHtml({ path: big, token: 4 })).state).toBe("failed");
  expect((await markdownHtml({ path: join(docs, "missing.md"), token: 5 })).state).toBe("failed");
});
