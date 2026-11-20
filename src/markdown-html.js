// Markdown to one passive HTML page, for a preview shown in a sandboxed web view
// (WebEngineView: buninu-browser's iframe, or Qt WebEngine). Bun.markdown.html writes the
// HTML; nothing it writes is used as it comes. Formulas are set aside first and set by
// src/mathml.js; the rest is parsed again and rebuilt from the same allowlist the QML
// preview applies to raw HTML (ui/js/MdHtml.js, ui/js/MdUrl.js): those tags, those
// attributes, http(s)/mailto/relative links, and only pictures inside the document's
// folder, which are embedded as data: URLs so the page loads nothing. A remote picture is
// a note naming its host. Mermaid fences are drawn by src/figure.js and embedded as SVG
// pictures (data: URLs in <img>, where an SVG runs nothing and loads nothing), sharing the
// pictures' budget. The page carries no script and no resource reference.
import { readFileSync, realpathSync, statSync } from "node:fs";
import { dirname, extname, resolve, sep } from "node:path";
import { texToMathML, cleanMathML } from "./mathml.js";
import { renderDiagram } from "./figure.js";

/** The largest Markdown source converted, as the QML preview's maxBytes default. */
export const MARKDOWN_LIMIT = 1 << 20;
// A large-page request (below) may also carry its pictures inline: up to 15 MB of them as
// base64 data: URLs, 4/3 larger, beside the 1 MB of text, as ui/js/ExtThumbs.js's
// markdownLimit. The text without those payloads is still held to MARKDOWN_LIMIT, so a file
// this large is pictures, not a page of text too long to lay out.
export const LARGE_MARKDOWN_FILE = 22 << 20;
const DATA_PAYLOAD = /data:image\/(?:png|jpeg|gif|webp|bmp);base64,[A-Za-z0-9+\/]+=*/gi;

const MD_OPTIONS = { tables: true, strikethrough: true, tasklists: true, headings: { ids: true } };

// Give every candidate its own URL so even identical bytes in a code block and a real
// picture are accounted separately. Only an image destination recognized by the parser
// gets the picture allowance. Keep its short URL until emission so reference-style
// images can reuse one payload without expanding it before the output budget is checked.
function prepareMarkdown(source, fileLimit) {
  const bytes = Buffer.byteLength(source);
  const tooLarge = () => { throw Error("Markdown preview exceeds size limit"); };
  if (bytes > fileLimit) tooLarge();
  if (!/data:image\//i.test(source)) {
    if (bytes > MARKDOWN_LIMIT) tooLarge();
    return { source };
  }
  const prefix = "flea-image:" + crypto.randomUUID() + "/";
  const matches = [];
  let textBytes = bytes;
  const shortened = source.replace(DATA_PAYLOAD, (url, offset) => {
    const key = prefix + matches.length;
    matches.push({ key, url, offset });
    textBytes -= url.length - "data:".length;
    return key;
  });
  if (textBytes > MARKDOWN_LIMIT) tooLarge();
  if (!matches.length) return { source };
  const used = new Set();
  const { text } = holdFormulas(shortened);
  new HTMLRewriter().on("img[src]", { element(el) { used.add(el.getAttribute("src")); } })
    .transform(Bun.markdown.html(text, MD_OPTIONS));
  const images = new Map();
  const parts = [];
  let start = 0;
  for (const { key, url, offset } of matches) {
    if (used.has(key)) {
      images.set(key, url);
      parts.push(source.slice(start, offset), key);
      start = offset + url.length;
    } else {
      textBytes += url.length - "data:".length;
      if (textBytes > MARKDOWN_LIMIT) tooLarge();
    }
  }
  parts.push(source.slice(start));
  return { source: parts.join(""), images };
}
// Qt WebEngine's loadHtml shows nothing past 2 MB (it loads a data: URL), so embedded
// pictures share 1 MB beside the at most 1 MB of text. buninu-browser shows the page as an
// iframe srcdoc, which has no such limit; a request that says so (largePage, sent when the
// QML runtime has navigator.buninu) gets 15 MB, which still scrolls acceptably there: about
// 2000 pictures of 7 KB.
const IMAGE_LIMIT = 1 << 20;
const IMAGES_TOTAL = 1 << 20;
export const LARGE_PAGE_IMAGES_TOTAL = 15 << 20;
// Diagrams drawn for one page; past this a fence stays source, so a page of broken diagrams
// cannot hold the backend for a deadline each.
export const DIAGRAMS_PER_PAGE = 32;

// Tags re-emitted with the attributes below; any other tag is dropped and its content kept.
const ALLOWED = new Set(("a b strong i em u s del strike sub sup kbd code br small mark span p div h1 h2 h3 h4 h5 h6 hr " +
  "img picture source details summary table thead tbody tr th td ul ol li blockquote pre font input").split(" "));
// Tags dropped with their content: active content, foreign namespaces (formulas come back
// through their own path), and the elements whose content the parser keeps as raw text,
// which would turn back into markup if only the tag were dropped.
const DROP_CONTENT = new Set(("script style iframe object embed template noscript svg math textarea title xmp " +
  "plaintext noembed noframes select option head").split(" "));
const VOID = new Set(["br", "hr", "img", "source", "input"]);
const GLOBAL_ATTRIBUTES = new Set(["id", "align", "alt", "width", "height", "title", "colspan", "rowspan"]);
const STRIKE_AS = { del: "s", strike: "s" };
const IMAGE_TYPES = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp", ".bmp": "image/bmp", ".avif": "image/avif" };

const escapeText = (text) => text.replaceAll("<", "&lt;").replaceAll(">", "&gt;");
const escapeAttribute = (value) => String(value).replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

// Entities, percent escapes and control characters undone until the text settles, as
// MdUrl.targetAllowed decodes before it judges a scheme; a target still changing after
// eight passes is refused.
function decodedTarget(raw) {
  let seen = String(raw);
  for (let pass = 0; pass < 8; pass++) {
    let next = seen.replace(/&(#x[0-9a-f]+|#\d+|colon|tab|newline|amp|lt|gt|quot|apos);?/gi, (all, name) => {
      const lower = name.toLowerCase();
      if (lower === "colon") return ":";
      if (lower === "tab") return "\t";
      if (lower === "newline") return "\n";
      if (lower[0] === "#") {
        const code = lower[1] === "x" ? parseInt(lower.slice(2), 16) : parseInt(lower.slice(1), 10);
        return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "";
      }
      return { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" }[lower];
    });
    try { next = decodeURIComponent(next); } catch {}
    next = next.replace(/[\u0000- \u007f-\u009f]/g, "");
    if (next === seen) return next;
    seen = next;
  }
  return null;
}

/** Whether a link target may stay: http(s), mailto, or no scheme (relative, #fragment). */
export function linkAllowed(raw) {
  const target = decodedTarget(raw);
  if (target === null) return false;
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(target)?.[1]?.toLowerCase();
  return !scheme || scheme === "http" || scheme === "https" || scheme === "mailto";
}

const isRemote = (url) => /^(https?:)?\/\//i.test(url);
const hostOf = (url) => {
  const rest = url.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "").replace(/^\/\//, "");
  const host = rest.split(/[/?#]/)[0].split("@").pop();
  return (host.startsWith("[") ? host.slice(0, host.indexOf("]") + 1) : host.split(":")[0]) || url;
};

/**
 * A picture's source: "remote" with its host, "local" with a data: URL for a file inside
 * `folder` (symbolic links resolved, so none leads out), or "dropped". Every other scheme,
 * except a base64 raster image, is dropped.
 */
const DATA_IMAGE = /^data:image\/(?:png|jpeg|gif|webp|bmp);base64,[A-Za-z0-9+\/]+={0,2}$/i;

export function classifyImage(raw, folder, budget) {
  const url = decodedTarget(raw ?? "");
  if (!url) return { kind: "dropped" };
  if (isRemote(url)) return { kind: "remote", host: hostOf(url) };
  // A picture the document carries itself: a raster type in base64, kept as written and
  // counted against the same limits as a file, by its decoded size.
  if (/^data:/i.test(url)) {
    if (!DATA_IMAGE.test(url)) return { kind: "dropped" };
    const size = Buffer.byteLength(url.slice(url.indexOf(",") + 1), "base64");
    if (size > IMAGE_LIMIT || size > budget.left) return { kind: "dropped" };
    budget.left -= size;
    return { kind: "local", url };
  }
  let path;
  if (/^file:/i.test(url)) path = url.replace(/^file:(\/\/)?/i, "");
  else if (/^[a-z][a-z0-9+.-]*:/i.test(url)) return { kind: "dropped" };
  else path = url.split(/[?#]/)[0];
  if (path.includes("\\")) return { kind: "dropped" };
  const type = IMAGE_TYPES[extname(path).toLowerCase()];
  if (!type) return { kind: "dropped" };
  try {
    const root = realpathSync(folder);
    const file = realpathSync(resolve(folder, path.startsWith("/") ? path : `./${path}`));
    if (file !== root && !file.startsWith(root + sep)) return { kind: "dropped" };
    const size = statSync(file).size;
    if (size > IMAGE_LIMIT || size > budget.left) return { kind: "dropped" };
    budget.left -= size;
    return { kind: "local", url: `data:${type};base64,${readFileSync(file).toString("base64")}` };
  } catch {
    return { kind: "dropped" };
  }
}

/**
 * Rebuilds HTML from the allowlist: allowed tags with their allowed attributes, text
 * escaped, everything else dropped (DROP_CONTENT with its content, other tags keeping
 * theirs). Nothing of the source survives as markup except what is emitted here.
 */
export function cleanHtml(source, folder, budget = { left: IMAGES_TOTAL }, images) {
  const out = [];
  let hidden = 0;
  new HTMLRewriter().on("*", {
    element(el) {
      const tag = el.tagName.toLowerCase();
      const foreign = el.namespaceURI !== "http://www.w3.org/1999/xhtml";
      if (hidden || DROP_CONTENT.has(tag) || foreign) {
        if (el.canHaveContent) { hidden++; el.onEndTag(() => { hidden--; }); }
        return;
      }
      if (!ALLOWED.has(tag)) return;
      const name = STRIKE_AS[tag] ?? (tag === "font" ? "span" : tag);
      let attributes = "";
      for (const [key, value] of el.attributes) {
        const attribute = key.toLowerCase();
        if (GLOBAL_ATTRIBUTES.has(attribute)) attributes += ` ${attribute}="${escapeAttribute(value)}"`;
        else if (attribute === "href" && tag === "a" && linkAllowed(value)) attributes += ` href="${escapeAttribute(value)}"`;
        // A task list's box: shown, never editable.
        else if (tag === "input" && attribute === "checked") attributes += " checked";
      }
      if (tag === "input") {
        if (String(el.getAttribute("type")).toLowerCase() !== "checkbox") return;
        attributes += ' type="checkbox" disabled';
      }
      if (tag === "img" || tag === "source") {
        if (tag === "source") return; // picture keeps its img; a source set is not followed
        const src = el.getAttribute("src");
        const picked = classifyImage(images?.get(src) ?? src, folder, budget);
        if (picked.kind === "remote") {
          out.push(`<span class="remote">Remote image not loaded · ${escapeText(picked.host)}</span>`);
          return;
        }
        if (picked.kind === "dropped") {
          const alt = el.getAttribute("alt");
          if (alt) out.push(`<span class="alt">${escapeText(alt)}</span>`);
          return;
        }
        attributes += ` src="${picked.url}"`;
      }
      out.push(`<${name}${attributes}>`);
      if (!VOID.has(tag) && el.canHaveContent) el.onEndTag(() => out.push(`</${name}>`));
    },
  }).onDocument({
    text(chunk) {
      if (!hidden) out.push(escapeText(chunk.text));
    },
  }).transform(String(source));
  return out.join("");
}

// ---- formulas ----

// Private-use markers, which Markdown leaves alone (it turns NUL into U+FFFD).
const OPEN = "", CLOSE = "";

/**
 * Sets formulas aside: $$…$$ and $…$ (TeX) and raw <math>…</math> (MathML), outside code
 * fences and code spans; and Mermaid fences (```mermaid, as the block view picks them: the
 * info string's first word, any case), each as a paragraph of its own. Returns the text with
 * markers, the formulas they stand for, and the diagrams' sources.
 */
export function holdFormulas(source) {
  const formulas = [];
  const diagrams = [];
  const hold = (formula) => `${OPEN}${formulas.push(formula) - 1}${CLOSE}`;
  const lines = String(source).replace(/[]/g, "�").split("\n");
  const kept = [];
  let fence = null;
  let prose = [];
  const flush = () => {
    if (!prose.length) return;
    let text = prose.join("\n");
    prose = [];
    // Code spans are kept whole: a run of backticks up to the same run.
    const spans = [];
    text = text.replace(/(`+)[\s\S]*?\1/g, (span) => `${spans.push(span) - 1}`);
    text = text
      .replace(/<math\b[\s\S]*?<\/math\s*>/gi, (markup) => hold({ markup }))
      .replace(/\$\$([\s\S]+?)\$\$/g, (_, tex) => hold({ tex, display: true }))
      // Inline TeX as pandoc reads it: no space just inside either $, and no digit right
      // after the closing one, so "$5 and $10" stays prose.
      .replace(/(^|[^\\$])\$(?=\S)([^$\n]*?\S)\$(?!\d)/g, (_, before, tex) => before + hold({ tex, display: false }));
    kept.push(text.replace(/(\d+)/g, (_, index) => spans[Number(index)]));
  };
  // A diagram's lines, with the fence's own indent taken off each, as CommonMark reads code.
  let diagram = null;
  const holdDiagram = () => {
    kept.push("", `${OPEN}d${diagrams.push(diagram.lines.join("\n")) - 1}${CLOSE}`, "");
    diagram = null;
  };
  for (const line of lines) {
    const opening = /^(\s{0,3})(`{3,}|~{3,})(.*)$/.exec(line);
    const marker = opening?.[2];
    if (diagram) {
      if (marker && marker[0] === diagram.fence[0] && marker.length >= diagram.fence.length && !opening[3].trim()) holdDiagram();
      else diagram.lines.push(line.replace(new RegExp(`^ {0,${diagram.indent}}`), ""));
    } else if (fence) {
      kept.push(line);
      if (marker && marker[0] === fence[0] && marker.length >= fence.length && !line.trim().slice(marker.length).trim()) fence = null;
    } else if (marker) {
      flush();
      // A backtick fence's info string holds no backtick (CommonMark), so ```mermaid` is not one.
      const info = opening[3].trim();
      if (/^mermaid(\s|$)/i.test(info) && !(marker[0] === "`" && info.includes("`")))
        diagram = { fence: marker, indent: opening[1].length, lines: [] };
      else {
        fence = marker;
        kept.push(line);
      }
    } else prose.push(line);
  }
  flush();
  // An unclosed fence runs to the end, as an unclosed code block does.
  if (diagram) holdDiagram();
  return { text: kept.join("\n"), formulas, diagrams };
}

// A formula's MathML, or its source as escaped text when it is refused.
function formulaHtml({ tex, display, markup }) {
  try {
    return markup !== undefined ? cleanMathML(markup) : texToMathML(tex, display);
  } catch {
    const source = markup ?? (display ? `$$${tex}$$` : `$${tex}$`);
    return `<code class="formula-source">${Bun.escapeHTML(source)}</code>`;
  }
}

// ---- the page ----

const HEX = /^#[0-9a-f]{6}$/i;
const colour = (value, fallback) => (HEX.test(String(value)) ? String(value) : fallback);

/** The page's own stylesheet, from the preview's theme colours (each checked as #rrggbb). */
export function pageStyle(theme = {}) {
  const fg = colour(theme.foreground, "#d8dee9"), bg = colour(theme.background, "#171b22");
  const muted = colour(theme.muted, "#8a93a6"), surface = colour(theme.surface, "#232833"), accent = colour(theme.accent, "#88c0d0");
  const body = Math.max(8, Math.min(40, Number(theme.bodyPx) || 14));
  return `html{background:${bg}}body{margin:12px 16px;color:${fg};background:${bg};font:${body}px sans-serif;line-height:1.7;overflow-wrap:anywhere}` +
    `a{color:${accent}}h1,h2{color:${fg}}h1{font-size:1.45em}h2{font-size:1.2em}h3,h4,h5,h6{font-size:1em}` +
    `pre,code,kbd{font-family:monospace;background:${surface}}code,kbd{padding:0 4px;border-radius:3px}` +
    `pre{padding:8px 12px;white-space:pre-wrap}pre code{padding:0;background:none}` +
    `blockquote{margin:0;padding-left:12px;border-left:3px solid ${muted};color:${muted}}` +
    `table{border-collapse:collapse}td,th{border:1px solid ${muted};padding:2px 8px}hr{border:0;border-top:1px solid ${muted}}` +
    `.remote{display:inline-block;border:1px dashed ${muted};color:${muted};padding:2px 6px}.alt{color:${muted}}` +
    `math[display=block]{display:block;margin:6px 0}.formula-source{color:${muted}}img{max-width:100%}` +
    `.diagram{margin:8px 0}.diagram-error{margin:-4px 0 8px;color:${muted};font-size:.9em}`;
}

// A diagram as a picture, or its source as a code block with the reason it was not drawn.
// `drawn` is renderDiagram's answer; none (a page built without drawing) leaves the source.
function diagramHtml(source, drawn, budget) {
  if (drawn?.svg !== undefined) {
    const bytes = Buffer.byteLength(drawn.svg);
    if (bytes <= budget.left) {
      budget.left -= bytes;
      return `<div class="diagram"><img alt="Mermaid diagram" src="data:image/svg+xml;base64,${Buffer.from(drawn.svg).toString("base64")}"></div>`;
    }
    drawn = { error: "over the page's picture budget" };
  }
  const code = `<pre><code>${escapeText(source.replaceAll("&", "&amp;"))}</code></pre>`;
  return drawn?.error ? `${code}<p class="diagram-error">Diagram not drawn · ${escapeText(drawn.error.replaceAll("&", "&amp;"))}</p>` : code;
}

// Bun's current heading slugger discards non-ASCII letters. Keep its HTML
// renderer, but repair generated IDs so Unicode tables of contents can resolve.
function unicodeHeadingIds(source, html) {
  const ids = new Map();
  const used = new Set();
  Bun.markdown.render(source, {
    heading(text, meta) {
      const plain = text.replace(/<[^>]*>/g, "");
      let base = /[^\x00-\x7f]/.test(plain)
        ? plain.toLowerCase().replace(/[^\p{L}\p{M}\p{N}_\s-]/gu, "").replace(/\s/g, "-")
        : meta.id;
      let id = base, suffix = 0;
      while (used.has(id)) id = base + "-" + (++suffix);
      used.add(id);
      ids.set(meta.id, id);
      return "";
    },
  }, { tables: true, strikethrough: true, tasklists: true, headings: { ids: true } });
  return new HTMLRewriter().on("h1,h2,h3,h4,h5,h6", {
    element(el) {
      const old = el.getAttribute("id");
      if (ids.has(old)) el.setAttribute("id", ids.get(old));
    },
  }).transform(html);
}

/**
 * One complete, passive page for a Markdown source in `folder`. `drawn` holds renderDiagram's
 * answer for each Mermaid fence in order (see markdownHtml); a fence without one stays source.
 */
export function markdownPage(source, folder, theme = {}, drawn = [], imagesTotal = IMAGES_TOTAL) {
  const prepared = prepareMarkdown(String(source), imagesTotal > IMAGES_TOTAL ? LARGE_MARKDOWN_FILE : MARKDOWN_LIMIT);
  return renderPage(prepared, folder, theme, drawn, imagesTotal);
}

function renderPage({ source, images }, folder, theme, drawn, imagesTotal) {
  const { text, formulas, diagrams } = holdFormulas(source);
  const html = unicodeHeadingIds(text, Bun.markdown.html(text, MD_OPTIONS));
  // Diagrams take their share of the picture budget first, in document order; pictures the rest.
  const budget = { left: imagesTotal };
  const figures = diagrams.map((diagram, index) => diagramHtml(diagram, drawn[index], budget));
  const body = cleanHtml(html, folder, budget, images)
    .replace(new RegExp(`(?:<p>)?${OPEN}d(\\d+)${CLOSE}(?:</p>)?`, "g"), (_, index) => figures[Number(index)] ?? "")
    .replace(new RegExp(`${OPEN}(\\d+)${CLOSE}`, "g"), (_, index) => formulas[Number(index)] ? formulaHtml(formulas[Number(index)]) : "");
  return `<!doctype html><meta charset="utf-8"><style>${pageStyle(theme)}</style>${body}`;
}

/** Draws a source's Mermaid fences under `theme`, in order, the first DIAGRAMS_PER_PAGE of them. */
export async function drawDiagrams(source, theme = {}) {
  const { diagrams } = holdFormulas(source);
  return Promise.all(diagrams.map((diagram, index) => index < DIAGRAMS_PER_PAGE
    ? renderDiagram(diagram, theme)
    : Promise.resolve({ error: `more than ${DIAGRAMS_PER_PAGE} diagrams on the page` })));
}

/** Render request.source when supplied, otherwise read request.path. The path also anchors relative images. */
export async function markdownHtml(request) {
  const answer = { t: "markdownhtml", slot: request.slot ?? "", token: request.token, state: "failed", html: "" };
  try {
    const path = String(request.path ?? "");
    const inline = typeof request.source === "string";
    const large = request.largePage === true;
    const fileLimit = large ? LARGE_MARKDOWN_FILE : MARKDOWN_LIMIT;
    if (!path || (!inline && statSync(path).size > fileLimit)) return answer;
    const source = inline ? request.source : await Bun.file(path).text();
    const prepared = prepareMarkdown(source, fileLimit);
    const theme = request.theme ?? {};
    const drawn = await drawDiagrams(prepared.source, theme);
    return { ...answer, state: "ready", html: renderPage(prepared, dirname(resolve(path)), theme, drawn,
      large ? LARGE_PAGE_IMAGES_TOTAL : IMAGES_TOTAL) };
  } catch {
    return answer;
  }
}
