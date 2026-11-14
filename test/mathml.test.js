import { test, expect } from "bun:test";
import { texToMathML, cleanMathML, cleanStyle, length, MATH_LIMIT } from "../src/mathml.js";

const ELEMENT = /<\/?([a-z][a-z0-9-]*)/g;
// Every element and attribute name in some cleaned markup.
const names = (html) => ({
  elements: [...new Set([...html.matchAll(ELEMENT)].map((match) => match[1]))],
  attributes: [...new Set([...html.matchAll(/\s([a-z-]+)="/g)].map((match) => match[1]))],
});
const ALLOWED_ELEMENTS = new Set(("math mrow mi mn mo ms mtext mspace mfrac msqrt mroot msub msup msubsup munder mover " +
  "munderover mmultiscripts mprescripts none mtable mtr mtd mstyle mpadded mphantom menclose merror semantics").split(" "));
const ALLOWED_ATTRIBUTES = new Set(("display displaystyle scriptlevel mathvariant form stretchy symmetric largeop movablelimits " +
  "fence separator accent accentunder lspace rspace width height depth voffset minsize maxsize linethickness style").split(" "));
const onlyAllowed = (html) => {
  const found = names(html);
  expect(found.elements.filter((name) => !ALLOWED_ELEMENTS.has(name))).toEqual([]);
  expect(found.attributes.filter((name) => !ALLOWED_ATTRIBUTES.has(name))).toEqual([]);
};

test("a formula becomes one math element of MathML Core elements", () => {
  const html = texToMathML("x=\\frac{-b\\pm\\sqrt{b^2-4ac}}{2a}", true);
  expect(html.startsWith('<math display="block">')).toBe(true);
  expect(html.endsWith("</math>")).toBe(true);
  expect(html).toContain("<mfrac>");
  expect(html).toContain("<msqrt>");
  onlyAllowed(html);
  for (const tex of ["\\begin{pmatrix}a&b\\\\c&d\\end{pmatrix}", "\\sum_{i=1}^n i", "\\boxed{E=mc^2}", "\\overbrace{a+b}^{n}", "\\hat x\\vec v", "\\text{中文 and emoji 😀}"])
    onlyAllowed(texToMathML(tex, true));
});

test("trust is off: links, URLs, images and HTML commands stay text", () => {
  for (const tex of ["\\href{javascript:alert(1)}{x}", "\\url{http://example.com}", "\\includegraphics{http://example.com/a.png}",
    "\\htmlClass{x}{y}", "\\htmlStyle{background:url(http://x)}{y}", "\\htmlData{a=b}{y}", "\\htmlId{x}{y}"]) {
    let html;
    try { html = texToMathML(tex); } catch { continue; } // a refused command is an error, which is also safe
    onlyAllowed(html);
    // The command's name and argument may show as text; no attribute carries them.
    expect(html).not.toMatch(/\s(?:href|src)="|url\(/i);
  }
});

test("markup typed into TeX never becomes markup", () => {
  for (const tex of ["\\text{<script>alert(1)</script>}", "\\text{</math><img src=x onerror=alert(1)>}", "\\mathrm{<b>x</b>}", "x<y>z"]) {
    let html;
    try { html = texToMathML(tex); } catch { continue; }
    onlyAllowed(html);
    // Typed markup survives only as escaped text.
    expect(html).not.toMatch(/<(?:script|img|b)[\s>]/i);
  }
});

test("runaway macros, huge sizes and long sources are refused", () => {
  expect(() => texToMathML("\\def\\a{\\a\\a}\\a")).toThrow();
  expect(() => texToMathML("x".repeat(MATH_LIMIT + 1))).toThrow();
  const sized = texToMathML("\\rule{1000em}{1000em}\\kern{1000em}");
  for (const [, value] of sized.matchAll(/(?:width|height|depth|lspace|rspace)="([^"]*)"/g)) expect(length(value)).toBe(true);
});

test("a TeX error is not turned into markup: the caller shows the source instead", () => {
  expect(() => texToMathML("\\frac{1}{")).toThrow();
  expect(() => texToMathML("\\text{a & b}")).toThrow();
});

test("the allowlist drops foreign content, handlers, links and unknown attributes", () => {
  const html = cleanMathML('<math><mi onclick="alert(1)" href="x" title="t" class="c">a</mi><mtext>t<img src="x" onerror="alert(1)">u</img></mtext>' +
    '<svg><script>alert(1)</script></svg><annotation-xml encoding="text/html"><b>x</b></annotation-xml><mo stretchy="maybe" form="infix">+</mo></math>');
  expect(html).toBe('<math><mi>a</mi><mtext>t</mtext><mo form="infix">+</mo></math>');
});

test("style keeps colours and box spacing only", () => {
  expect(cleanStyle("color:#ff0000;padding:3pt;border:1px solid;background:url(http://x);position:fixed;margin-left:-0.1667em")).toBe(
    "color:#ff0000;padding:3pt;border:1px solid;margin-left:-0.1667em");
  expect(cleanStyle("color:expression(alert(1));padding:1e9em;color:red")).toBe("");
  expect(cleanStyle("padding:-1em;border:1px solid url(x)")).toBe("");
});

test("only strict, balanced markup with exactly one math root is accepted", () => {
  for (const bad of ["<math><mi>a<!-- x --></mi></math>", "<math><mi title=a>a</mi></math>", "<math><mi>a</mo></math>",
    "<math><mi>a</mi>", "<math><mi>a</mi></math><math><mi>b</mi></math>", "<p><math><mi>x</mi></math></p>", "<math><![CDATA[x]]></math>"])
    expect(() => cleanMathML(bad)).toThrow();
});

test("text keeps entities as text and escapes stray ampersands and brackets", () => {
  expect(cleanMathML("<math><mtext>&lt;b&gt; &amp;bogus; & x > y</mtext></math>")).toBe("<math><mtext>&lt;b&gt; &amp;bogus; &amp; x &gt; y</mtext></math>");
});

test("nesting past the depth limit is dropped", () => {
  const deep = "<math>" + "<mrow>".repeat(80) + "<mi>x</mi>" + "</mrow>".repeat(80) + "</math>";
  const html = cleanMathML(deep);
  expect((html.match(/<mrow>/g) ?? []).length).toBe(63);
  expect(html).not.toContain("<mi>");
});
