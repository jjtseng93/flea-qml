// TeX to MathML for the Markdown preview: Temml writes MathML, and the result is never
// used as it comes. It is parsed again and rebuilt from an allowlist, the way
// src/html.js rebuilds passive HTML: MathML Core elements only, each attribute checked
// against the values layout reads, and from style only colours, box spacing and a
// plain border. Nothing that loads, links or runs can reach the output.
import temml from "./vendor/temml.mjs";

/** The longest TeX source converted, as the figure helper's MATH_LIMIT. */
export const MATH_LIMIT = 4096;
const OUTPUT_LIMIT = 256 * 1024;
const DEPTH_LIMIT = 64;

// MathML Core elements (https://w3c.github.io/mathml-core/#mathml-elements-and-attributes)
// and menclose, which Temml writes for \boxed and \overline.
const ELEMENTS = new Set(("math mrow mi mn mo ms mtext mspace mfrac msqrt mroot msub msup msubsup munder mover " +
  "munderover mmultiscripts mprescripts none mtable mtr mtd mstyle mpadded mphantom menclose merror semantics").split(" "));
// Dropped with everything inside them.
const DROP = new Set(["annotation", "annotation-xml"]);

const BOOLEAN = /^(?:true|false)$/i;
const NUMBER = "[+-]?(?:\\d{1,4}(?:\\.\\d{1,6})?|\\.\\d{1,6})";
const LENGTH = new RegExp(`^\\s*(${NUMBER})\\s*(em|ex|px|pt|%)?\\s*$`, "i");
// The largest length kept, per unit: a huge space or rule is a way to cover the pane.
const LENGTH_MAX = { em: 50, ex: 100, px: 1000, pt: 750, "%": 1000, "": 0 };
const ATTRIBUTES = {
  display: (value) => /^(?:block|inline)$/i.test(value),
  displaystyle: (value) => BOOLEAN.test(value),
  scriptlevel: (value) => /^[+-]?\d{1,2}$/.test(value),
  mathvariant: (value) => /^(?:normal|bold|italic|bold-italic)$/i.test(value),
  form: (value) => /^(?:prefix|infix|postfix)$/i.test(value),
  stretchy: (value) => BOOLEAN.test(value),
  symmetric: (value) => BOOLEAN.test(value),
  largeop: (value) => BOOLEAN.test(value),
  movablelimits: (value) => BOOLEAN.test(value),
  fence: (value) => BOOLEAN.test(value),
  separator: (value) => BOOLEAN.test(value),
  accent: (value) => BOOLEAN.test(value),
  accentunder: (value) => BOOLEAN.test(value),
  lspace: length, rspace: length, width: length, height: length, depth: length, voffset: length,
  minsize: length, maxsize: length, linethickness: length,
};

/** A MathML Core length within the limits above (unitless only as zero). */
export function length(value) {
  const match = LENGTH.exec(String(value));
  if (!match) return false;
  const unit = (match[2] ?? "").toLowerCase();
  return Math.abs(Number(match[1])) <= LENGTH_MAX[unit];
}

const COLOR = /^(?:#[0-9a-f]{3,4}|#[0-9a-f]{6}|#[0-9a-f]{8}|rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*(?:,\s*(?:0|1|0?\.\d+)\s*)?\))$/i;
const BOX_LENGTHS = (value, negative) => {
  const parts = value.trim().split(/\s+/);
  return parts.length >= 1 && parts.length <= 4 && parts.every((part) => length(part) && (negative || !part.trim().startsWith("-")));
};
const STYLE = {
  color: (value) => COLOR.test(value),
  "background-color": (value) => COLOR.test(value),
  padding: (value) => BOX_LENGTHS(value, false),
  "padding-top": (value) => BOX_LENGTHS(value, false), "padding-right": (value) => BOX_LENGTHS(value, false),
  "padding-bottom": (value) => BOX_LENGTHS(value, false), "padding-left": (value) => BOX_LENGTHS(value, false),
  "margin-left": (value) => BOX_LENGTHS(value, true), "margin-right": (value) => BOX_LENGTHS(value, true),
  border: (value) => /^\s*(\S+)\s+(?:solid|dashed|dotted)(?:\s+(\S+))?\s*$/i.test(value)
    && length(value.trim().split(/\s+/)[0]) && (value.trim().split(/\s+/)[2] === undefined || COLOR.test(value.trim().split(/\s+/)[2])),
};

/** The allowed declarations of a style attribute, rebuilt; empty when none survive. */
export function cleanStyle(source) {
  const kept = [];
  for (const declaration of String(source).split(";")) {
    const colon = declaration.indexOf(":");
    if (colon < 0) continue;
    const name = declaration.slice(0, colon).trim().toLowerCase();
    const value = declaration.slice(colon + 1).trim();
    // A comment, escape or function call other than rgb() never survives the value checks,
    // but refuse them up front so the checks only ever see plain values.
    if (!STYLE[name] || /[\\/*"'<>&{}]|url\s*\(|expression|@/i.test(value)) continue;
    if (STYLE[name](value)) kept.push(`${name}:${value}`);
  }
  return kept.join(";");
}

const escapeAttribute = (value) => String(value).replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

// Entity references a text run or attribute value may hold; anything else that starts
// with "&" is escaped, so it stays text.
const ENTITY = /&(?:amp|lt|gt|quot|apos|#\d{1,7}|#x[0-9a-f]{1,6});/iy;
const NAMED = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
const decode = (value) => value.replace(/&(amp|lt|gt|quot|apos|#\d{1,7}|#x[0-9a-f]{1,6});/gi, (all, name) => {
  if (name[0] !== "#") return NAMED[name.toLowerCase()];
  const code = name[1].toLowerCase() === "x" ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
  return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : "\ufffd";
});
const escapeText = (value) => {
  let out = "";
  for (let index = 0; index < value.length; index++) {
    const character = value[index];
    if (character === "&") {
      ENTITY.lastIndex = index;
      out += ENTITY.test(value) ? "&" : "&amp;";
    } else out += character === ">" ? "&gt;" : character;
  }
  return out;
};

// The markup Temml writes: start tags with double-quoted attributes, "/>" or end tags,
// and text without "<". Comments, CDATA, doctypes, processing instructions, unquoted
// or single-quoted attributes and unbalanced tags are refused, not repaired.
const TOKEN = /<\/([a-z][a-z0-9-]*)\s*>|<([a-z][a-z0-9-]*)((?:\s+[a-z_:][-a-z0-9_:.]*\s*=\s*"[^"<]*")*)\s*(\/?)>|([^<]+)/giy;
const ATTRIBUTE = /([a-z_:][-a-z0-9_:.]*)\s*=\s*"([^"<]*)"/gi;

/**
 * Rebuilds MathML from the allowlist. Whatever is not an allowed MathML element (HTML,
 * SVG, annotations, anything past the depth limit) is dropped with its content; an
 * unknown MathML-looking element keeps its children as an mrow. Throws when the input
 * is not strict markup, or the result is not one <math> element or is too large.
 */
export function cleanMathML(source) {
  const markup = String(source);
  if (Buffer.byteLength(markup) > OUTPUT_LIMIT) throw Error("MathML exceeds size limit");
  const out = [];
  const stack = []; // {name, kept, output}
  let hidden = 0, roots = 0;
  TOKEN.lastIndex = 0;
  while (TOKEN.lastIndex < markup.length) {
    const at = TOKEN.lastIndex;
    const match = TOKEN.exec(markup);
    if (!match || match.index !== at) throw Error("MathML is not strict markup");
    const [, endName, startName, attributeText, selfClosing, text] = match;
    if (text !== undefined) {
      if (!hidden && stack.length) out.push(escapeText(text));
      continue;
    }
    if (endName !== undefined) {
      const open = stack.pop();
      if (!open || open.name !== endName.toLowerCase()) throw Error("MathML tags are unbalanced");
      if (open.kept) out.push(`</${open.output}>`);
      else if (open.hides) hidden--;
      continue;
    }
    const tag = startName.toLowerCase();
    const depth = stack.length;
    // MathML only: a known element, or one of Temml's own kept as mrow; <math> only at the root.
    const looksMathML = ELEMENTS.has(tag) || /^m[a-z]+$/.test(tag);
    const drop = hidden > 0 || !looksMathML || DROP.has(tag) || depth >= DEPTH_LIMIT || (tag === "math") !== (depth === 0);
    const entry = { name: tag, kept: !drop, hides: drop && !hidden, output: ELEMENTS.has(tag) ? tag : "mrow" };
    if (drop) {
      if (entry.hides) hidden++;
    } else {
      if (tag === "math") roots++;
      let attributes = "";
      for (const [, key, raw] of attributeText.matchAll(ATTRIBUTE)) {
        const attribute = key.toLowerCase();
        const value = decode(raw);
        if (attribute === "style") {
          const style = cleanStyle(value);
          if (style) attributes += ` style="${escapeAttribute(style)}"`;
        } else if (ATTRIBUTES[attribute]?.(value)) attributes += ` ${attribute}="${escapeAttribute(value.trim())}"`;
      }
      out.push(`<${entry.output}${attributes}>`);
    }
    if (selfClosing) {
      if (entry.kept) out.push(`</${entry.output}>`);
      else if (entry.hides) hidden--;
    } else stack.push(entry);
  }
  if (stack.length) throw Error("MathML tags are unbalanced");
  const html = out.join("");
  if (roots !== 1 || !html.startsWith("<math") || !html.endsWith("</math>")) throw Error("not one MathML formula");
  return html;
}

/**
 * MathML for one TeX formula, cleaned. Temml runs with trust off (no \href, \url,
 * \includegraphics or \html*), bounded macro expansion and sizes, and reports a TeX
 * error as an <merror> inside the formula rather than throwing.
 */
export function texToMathML(tex, display = false) {
  const source = String(tex ?? "");
  if (source.length > MATH_LIMIT) throw Error("formula exceeds size limit");
  const markup = temml.renderToString(source, {
    displayMode: Boolean(display), trust: false, throwOnError: false, maxExpand: 1000, maxSize: 20, strict: false,
    annotate: false, xml: false, wrap: "none",
  });
  return cleanMathML(markup);
}
