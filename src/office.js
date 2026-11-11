// Office documents for the preview, read by this process with no converter: a DOCX, ODT, PPTX or
// ODP becomes a passive HTML fragment for src/html.js (headings, emphasis, lists and tables), and
// an XLSX or ODS becomes the CSV of its first sheet for the table view (ui/CsvTable.qml).
// A container whose content cannot be read answers the names of its zip members instead, the
// listing an archive preview shows. Upstream: src/backend/officepdf.rs and officesheets.rs, which
// run LibreOffice; nothing here lays a page out, so fonts, images and page breaks are not drawn.
import { statSync } from "node:fs";
import { openZip } from "./archive.js";

// A container over this is not opened, and one XML member over MEMBER_LIMIT is not inflated.
export const OFFICE_LIMIT = 64 << 20;
const MEMBER_LIMIT = 32 << 20;
// src/html.js refuses a fragment over 1 MiB and src/code.js shows the first 1 MiB of text, so the
// conversion stops before either and says so.
const OUTPUT_LIMIT = 900_000;
const NAME_CAP = 64;
const TRUNCATED = "[Preview truncated]";

const KINDS = {
  docx: "document", docm: "document", odt: "document",
  pptx: "slides", pptm: "slides", odp: "slides",
  xlsx: "sheet", xlsm: "sheet", ods: "sheet",
};

/** "document", "slides" or "sheet" for a name this file reads, "" for any other. */
export function officeKind(name) {
  const text = String(name ?? ""),
    dot = text.lastIndexOf(".");
  return dot < 0 ? "" : (KINDS[text.slice(dot + 1).toLowerCase()] ?? "");
}

// ---- XML ----

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
const decode = (text) =>
  text.includes("&")
    ? text.replace(/&(#[xX][0-9a-fA-F]+|#\d+|\w+);/g, (match, name) => {
        if (name[0] !== "#") return ENTITIES[name] ?? match;
        const code = /^#[xX]/.test(name) ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
        return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : "�";
      })
    : text;
// Control characters have no glyph and are not valid in the fragment; tab and newline are kept.
const clean = (text) => text.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, "");
const escape = (text) => clean(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const TOKEN =
  /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[([\s\S]*?)\]\]>|<(\/?)([A-Za-z_][\w:.\-]*)((?:"[^"]*"|'[^']*'|[^<>"'])*?)(\/?)>|([^<]+)/g;

// Walks one XML member: open(name, attributes, selfClosing), close(name) and text(decoded) in
// document order. A self-closing element reports open and then close. open or text returning
// false ends the walk. A DOCTYPE is refused, so no entity a document declares is ever expanded.
function walk(source, { open, close, text }) {
  if (/<!DOCTYPE/i.test(source.slice(0, 4096))) throw new Error("XML with a DOCTYPE is not read");
  TOKEN.lastIndex = 0;
  for (let match; (match = TOKEN.exec(source)); ) {
    if (match[3] !== undefined) {
      if (match[2]) close?.(match[3]);
      else {
        if (open?.(match[3], match[4], match[5] === "/") === false) return;
        if (match[5] === "/") close?.(match[3]);
      }
    } else if (match[1] !== undefined) {
      if (text?.(match[1]) === false) return;
    } else if (match[6] !== undefined) {
      if (text?.(decode(match[6])) === false) return;
    }
  }
}

const attributePatterns = new Map();
function attribute(attributes, name) {
  if (!attributes) return undefined;
  let pattern = attributePatterns.get(name);
  if (!pattern) {
    pattern = new RegExp(`(?:^|\\s)${name.replace(/[.:\-]/g, "\\$&")}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`);
    attributePatterns.set(name, pattern);
  }
  const match = pattern.exec(attributes);
  return match ? decode(match[1] ?? match[2]) : undefined;
}

function member(zip, name) {
  const bytes = zip.read(name, MEMBER_LIMIT);
  if (!bytes) throw new Error(`missing ${name}`);
  return bytes.toString("utf8");
}
const optional = (zip, name) => (zip.sizes.has(name) ? member(zip, name) : "");

// Relationship targets by id; `base` is the directory the part that owns them sits in.
function relationships(zip, name, base) {
  const targets = new Map();
  const source = optional(zip, name);
  if (source)
    walk(source, {
      open(tag, attributes) {
        if (tag !== "Relationship") return;
        const id = attribute(attributes, "Id"),
          target = attribute(attributes, "Target");
        if (id && target) targets.set(id, target.startsWith("/") ? target.slice(1) : base + target);
      },
    });
  return targets;
}

// ---- the fragment ----

// Blocks land in the innermost open table cell, or in the body. Consecutive list items share one
// list, and a cell separates its paragraphs with line breaks, so the fragment's tags stay balanced
// however a document nests them. `full` turns true at the output limit and the walk ends there.
class Fragment {
  constructor() {
    this.body = { parts: [], list: "" };
    this.containers = [this.body];
    this.tables = [];
    this.size = 0;
    this.full = false;
  }
  get top() {
    return this.containers.at(-1);
  }
  #push(container, html) {
    container.parts.push(html);
    if (container === this.body) {
      this.size += html.length;
      if (this.size > OUTPUT_LIMIT) this.full = true;
    }
  }
  #endList(container) {
    if (container.list) this.#push(container, `</${container.list}>`);
    container.list = "";
  }
  /** A paragraph: `tag` wraps it in the body, `list` ("ul" or "ol") makes it an item instead. */
  block(tag, inline, list = "") {
    if (!inline.trim()) return;
    const container = this.top;
    if (container !== this.body) {
      // Inside a table cell every paragraph is a line.
      this.#push(container, (container.parts.length ? "<br>" : "") + inline);
      return;
    }
    if (list) {
      if (container.list !== list) {
        this.#endList(container);
        this.#push(container, `<${list}>`);
        container.list = list;
      }
      this.#push(container, `<li>${inline}</li>`);
      return;
    }
    this.#endList(container);
    this.#push(container, `<${tag}>${inline}</${tag}>`);
  }
  tableOpen() {
    this.tables.push({ rows: [], row: null });
  }
  rowOpen() {
    const table = this.tables.at(-1);
    if (table) table.row = [];
  }
  cellOpen() {
    if (this.tables.at(-1)?.row) this.containers.push({ parts: [], list: "", cell: true });
  }
  cellClose() {
    const table = this.tables.at(-1);
    if (!table?.row || !this.top.cell) return;
    table.row.push(this.containers.pop().parts.join(""));
  }
  rowClose() {
    const table = this.tables.at(-1);
    if (!table?.row) return;
    if (table.row.length) table.rows.push(table.row);
    table.row = null;
  }
  tableClose() {
    // A table that ends inside an unfinished cell or row takes them with it.
    while (this.top.cell && this.tables.at(-1)?.row) this.cellClose();
    this.rowClose();
    const table = this.tables.pop();
    if (!table || !table.rows.some((row) => row.some((cell) => cell.trim()))) return;
    const html = `<table>${table.rows.map((row) => `<tr>${row.map((cell) => `<td>${cell}</td>`).join("")}</tr>`).join("")}</table>`;
    const container = this.top;
    if (container === this.body) this.#endList(container);
    this.#push(container, html);
  }
  html() {
    // Whatever the walk left open is closed here, so a truncated document still balances.
    while (this.tables.length) this.tableClose();
    this.#endList(this.body);
    if (this.full) this.body.parts.push(`<p>${TRUNCATED}</p>`);
    return this.body.parts.join("");
  }
}

const STYLE_TAGS = [["b", "b"], ["i", "i"], ["u", "u"], ["s", "s"], ["sup", "sup"], ["sub", "sub"]];
function styled(text, style) {
  let html = escape(text);
  if (!html) return "";
  if (style) for (const [key, tag] of STYLE_TAGS) if (style[key]) html = `<${tag}>${html}</${tag}>`;
  return html;
}
const TAB = "&nbsp;&nbsp;&nbsp;&nbsp;";
// An OOXML toggle is on when present, unless its value says otherwise.
const on = (attributes, name = "w:val") => !["0", "false", "none", "off"].includes(attribute(attributes, name) ?? "1");

// ---- DOCX ----

// Heading level by paragraph style id, from the style's own name ("heading 2", "Title").
function docxHeadings(zip) {
  const levels = new Map();
  const source = optional(zip, "word/styles.xml");
  if (!source) return levels;
  let id = "";
  walk(source, {
    open(tag, attributes) {
      if (tag === "w:style") id = attribute(attributes, "w:styleId") ?? "";
      else if (tag === "w:name" && id) {
        const name = (attribute(attributes, "w:val") ?? "").toLowerCase();
        const heading = /^heading ([1-6])$/.exec(name);
        if (heading) levels.set(id, Number(heading[1]));
        else if (name === "title") levels.set(id, 1);
        else if (name === "subtitle") levels.set(id, 2);
      }
    },
    close(tag) {
      if (tag === "w:style") id = "";
    },
  });
  return levels;
}

// Whether a numbering id counts (true) or bullets (false), from its first level's format.
function docxNumbering(zip) {
  const ordered = new Map();
  const source = optional(zip, "word/numbering.xml");
  if (!source) return ordered;
  const abstract = new Map();
  let abstractId = "", level = "", numId = "";
  walk(source, {
    open(tag, attributes) {
      if (tag === "w:abstractNum") abstractId = attribute(attributes, "w:abstractNumId") ?? "";
      else if (tag === "w:lvl") level = attribute(attributes, "w:ilvl") ?? "";
      else if (tag === "w:numFmt" && abstractId && level === "0")
        abstract.set(abstractId, !["bullet", "none"].includes(attribute(attributes, "w:val") ?? ""));
      else if (tag === "w:num") numId = attribute(attributes, "w:numId") ?? "";
      else if (tag === "w:abstractNumId" && numId) ordered.set(numId, abstract.get(attribute(attributes, "w:val") ?? "") ?? false);
    },
    close(tag) {
      if (tag === "w:abstractNum") abstractId = "";
      else if (tag === "w:num") numId = "";
    },
  });
  return ordered;
}

// Deleted text, a field's instruction and the fallback copy of a drawing are not the document's text.
const DOCX_SKIP = new Set(["w:del", "w:delText", "w:instrText", "mc:Fallback", "w:moveFrom"]);

function docxHtml(zip) {
  const source = member(zip, "word/document.xml");
  const headings = docxHeadings(zip),
    numbering = docxNumbering(zip),
    out = new Fragment(),
    paragraphs = [];
  let skip = 0, inParagraphProperties = false, inRunProperties = false, inText = false, run = null;
  walk(source, {
    open(tag, attributes) {
      if (skip || DOCX_SKIP.has(tag)) {
        skip++;
        return;
      }
      const paragraph = paragraphs.at(-1);
      switch (tag) {
        case "w:p": paragraphs.push({ tag: "p", list: "", parts: [] }); break;
        case "w:pPr": inParagraphProperties = true; break;
        case "w:pStyle": {
          const id = attribute(attributes, "w:val") ?? "";
          const level = headings.get(id) ?? Number(/^heading\s*([1-6])$/i.exec(id)?.[1] ?? 0);
          if (paragraph && level) paragraph.tag = `h${level}`;
          break;
        }
        case "w:numId": {
          const id = attribute(attributes, "w:val") ?? "0";
          if (paragraph && inParagraphProperties && id !== "0") paragraph.list = numbering.get(id) ? "ol" : "ul";
          break;
        }
        case "w:r": run = {}; break;
        case "w:rPr": inRunProperties = !inParagraphProperties && run !== null; break;
        case "w:b": if (inRunProperties) run.b = on(attributes); break;
        case "w:i": if (inRunProperties) run.i = on(attributes); break;
        case "w:u": if (inRunProperties) run.u = on(attributes); break;
        case "w:strike":
        case "w:dstrike": if (inRunProperties) run.s = on(attributes); break;
        case "w:vertAlign": {
          const value = attribute(attributes, "w:val");
          if (inRunProperties) { run.sup = value === "superscript"; run.sub = value === "subscript"; }
          break;
        }
        case "w:t": inText = true; break;
        case "w:tab": if (paragraph && run && !inParagraphProperties) paragraph.parts.push(TAB); break;
        case "w:br":
        case "w:cr": if (paragraph && run) paragraph.parts.push("<br>"); break;
        case "w:noBreakHyphen": if (paragraph && run) paragraph.parts.push("-"); break;
        case "w:tbl": out.tableOpen(); break;
        case "w:tr": out.rowOpen(); break;
        case "w:tc": out.cellOpen(); break;
      }
    },
    close(tag) {
      if (skip) {
        skip--;
        return;
      }
      switch (tag) {
        case "w:p": {
          const paragraph = paragraphs.pop();
          if (paragraph) out.block(paragraph.tag, paragraph.parts.join(""), paragraph.tag === "p" ? paragraph.list : "");
          break;
        }
        case "w:pPr": inParagraphProperties = false; break;
        case "w:rPr": inRunProperties = false; break;
        case "w:r": run = null; break;
        case "w:t": inText = false; break;
        case "w:tc": out.cellClose(); break;
        case "w:tr": out.rowClose(); break;
        case "w:tbl": out.tableClose(); break;
      }
      return undefined;
    },
    text(value) {
      if (skip || !inText) return undefined;
      paragraphs.at(-1)?.parts.push(styled(value, run));
      return !out.full;
    },
  });
  return out.html();
}

// ---- PPTX ----

// Slide members in presentation order, by the presentation's own list; by number when it has none.
function pptxSlides(zip) {
  const targets = relationships(zip, "ppt/_rels/presentation.xml.rels", "ppt/");
  const slides = [];
  const source = optional(zip, "ppt/presentation.xml");
  if (source)
    walk(source, {
      open(tag, attributes) {
        const target = tag === "p:sldId" ? targets.get(attribute(attributes, "r:id") ?? "") : undefined;
        if (target && zip.sizes.has(target)) slides.push(target);
      },
    });
  if (slides.length) return slides;
  const number = (name) => Number(/(\d+)\.xml$/.exec(name)[1]);
  return zip.names.filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name)).sort((a, b) => number(a) - number(b));
}

function pptxHtml(zip) {
  const slides = pptxSlides(zip);
  if (!slides.length) throw new Error("no slides");
  const out = new Fragment();
  slides.every((name, index) => {
    out.block("h2", escape(`Slide ${index + 1}`));
    let paragraph = null, run = null, inText = false, title = false;
    walk(member(zip, name), {
      open(tag, attributes) {
        switch (tag) {
          case "p:sp": title = false; break;
          case "p:ph": title = ["title", "ctrTitle"].includes(attribute(attributes, "type") ?? ""); break;
          case "a:p": paragraph = []; break;
          case "a:r":
          case "a:fld": run = {}; break;
          case "a:rPr":
            if (!run) break;
            run.b = attribute(attributes, "b") === "1";
            run.i = attribute(attributes, "i") === "1";
            run.u = !["none", undefined].includes(attribute(attributes, "u"));
            run.s = !["noStrike", undefined].includes(attribute(attributes, "strike"));
            break;
          case "a:t": inText = true; break;
          case "a:br": paragraph?.push("<br>"); break;
          case "a:tbl": out.tableOpen(); break;
          case "a:tr": out.rowOpen(); break;
          case "a:tc": out.cellOpen(); break;
        }
      },
      close(tag) {
        switch (tag) {
          case "a:p":
            if (paragraph) out.block(title ? "h3" : "p", paragraph.join(""));
            paragraph = null;
            break;
          case "a:r":
          case "a:fld": run = null; break;
          case "a:t": inText = false; break;
          case "a:tc": out.cellClose(); break;
          case "a:tr": out.rowClose(); break;
          case "a:tbl": out.tableClose(); break;
        }
      },
      text(value) {
        if (inText && paragraph) paragraph.push(styled(value, run));
        return !out.full;
      },
    });
    return !out.full;
  });
  return out.html();
}

// ---- ODT and ODP ----

// Change tracking, comments, footnotes, speaker notes and form controls are not the body text.
const ODF_SKIP = new Set(["text:tracked-changes", "office:annotation", "text:note", "presentation:notes", "office:forms", "draw:plugin"]);

function odfHtml(zip, slides) {
  const source = member(zip, "content.xml");
  const styles = new Map(),
    out = new Fragment(),
    paragraphs = [],
    spans = [];
  let skip = 0, styleName = "", lists = 0, slide = 0, body = false;
  const current = () => {
    const merged = {};
    for (const name of spans) Object.assign(merged, styles.get(name));
    return merged;
  };
  walk(source, {
    open(tag, attributes) {
      if (skip || ODF_SKIP.has(tag)) {
        skip++;
        return undefined;
      }
      const paragraph = paragraphs.at(-1);
      switch (tag) {
        case "style:style": styleName = attribute(attributes, "style:name") ?? ""; break;
        case "style:text-properties": {
          if (!styleName) break;
          const position = attribute(attributes, "style:text-position") ?? "";
          styles.set(styleName, {
            b: attribute(attributes, "fo:font-weight") === "bold",
            i: attribute(attributes, "fo:font-style") === "italic",
            u: !["none", undefined].includes(attribute(attributes, "style:text-underline-style")),
            s: !["none", undefined].includes(attribute(attributes, "style:text-line-through-style")),
            sup: position.startsWith("super"),
            sub: position.startsWith("sub"),
          });
          break;
        }
        case "office:body": body = true; break;
        case "draw:page": if (slides) out.block("h2", escape(`Slide ${++slide}`)); break;
        case "text:h": {
          const level = Math.min(6, Math.max(1, Number(attribute(attributes, "text:outline-level") ?? 1) || 1));
          if (body) paragraphs.push({ tag: `h${level}`, parts: [] });
          break;
        }
        case "text:p": if (body) paragraphs.push({ tag: "p", parts: [] }); break;
        case "text:list": lists++; break;
        case "text:span": spans.push(attribute(attributes, "text:style-name") ?? ""); break;
        case "text:s": paragraph?.parts.push("&nbsp;".repeat(Math.min(64, Math.max(1, Number(attribute(attributes, "text:c") ?? 1) || 1)))); break;
        case "text:tab": paragraph?.parts.push(TAB); break;
        case "text:line-break": paragraph?.parts.push("<br>"); break;
        case "table:table": if (body) out.tableOpen(); break;
        case "table:table-row": if (body) out.rowOpen(); break;
        case "table:table-cell":
        case "table:covered-table-cell": if (body) out.cellOpen(); break;
      }
      return undefined;
    },
    close(tag) {
      if (skip) {
        skip--;
        return;
      }
      switch (tag) {
        case "style:style": styleName = ""; break;
        case "text:h":
        case "text:p": {
          const paragraph = paragraphs.pop();
          if (paragraph) out.block(paragraph.tag, paragraph.parts.join(""), lists > 0 && paragraph.tag === "p" ? "ul" : "");
          break;
        }
        case "text:list": lists = Math.max(0, lists - 1); break;
        case "text:span": spans.pop(); break;
        case "table:table-cell":
        case "table:covered-table-cell": if (body) out.cellClose(); break;
        case "table:table-row": if (body) out.rowClose(); break;
        case "table:table": if (body) out.tableClose(); break;
      }
    },
    text(value) {
      if (skip) return undefined;
      paragraphs.at(-1)?.parts.push(styled(value, current()));
      return !out.full;
    },
  });
  return out.html();
}

// ---- sheets ----

const field = (value) => {
  const text = clean(String(value)).replace(/\r\n?/g, "\n");
  return /[",\n]|^\s|\s$/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

// Rows as CSV lines, without the empty cells that trail a row or the empty rows that trail a sheet.
class Csv {
  constructor() {
    this.lines = [];
    this.size = 0;
    this.blank = 0;
    this.full = false;
  }
  row(cells) {
    let end = cells.length;
    while (end > 0 && (cells[end - 1] === undefined || cells[end - 1] === "")) end--;
    if (end === 0) {
      this.blank++;
      return;
    }
    // Empty rows between two filled ones keep their place; the cap also bounds a gap of millions.
    for (; this.blank > 0 && !this.full; this.blank--) this.#push("");
    this.blank = 0;
    const line = [];
    for (let index = 0; index < end; index++) line.push(field(cells[index] ?? ""));
    this.#push(line.join(","));
  }
  #push(line) {
    if (this.full) return;
    this.lines.push(line);
    this.size += line.length + 1;
    if (this.size > OUTPUT_LIMIT) this.full = true;
  }
  text(note) {
    const lines = this.lines.slice();
    if (this.full) lines.push(field(TRUNCATED));
    if (note) lines.push(field(note));
    return lines.length ? lines.join("\n") + "\n" : "";
  }
}
const sheetNote = (names) => (names.length > 1 ? `[Sheet 1 of ${names.length}: ${names[0]}. The other sheets are not shown.]` : "");

// Column index of a cell reference: "A1" is 0, "AB7" is 27.
function columnOf(reference) {
  let column = 0;
  for (let index = 0; index < reference.length; index++) {
    const code = reference.charCodeAt(index) & ~0x20;
    if (code < 65 || code > 90) break;
    column = column * 26 + code - 64;
  }
  return column - 1;
}
const COLUMN_CAP = 16384;
// One filled row a sheet repeats is written at most this many times.
const ROW_REPEAT_CAP = 1000;

// Whether a number format shows a date or a time: the built-in ids, or a custom code with date letters.
const BUILTIN_DATES = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 45, 46, 47, 50, 51, 52, 53, 54, 55, 56, 57, 58]);
const isDateCode = (code) => /[ymdhs]/i.test(code.replace(/"[^"]*"|\[[^\]]*\]|\\./g, "")) && !/^general$/i.test(code);

// A date serial as ISO text: a whole number is a date, a fraction below one a time, and otherwise both.
function serialDate(serial, date1904) {
  if (!Number.isFinite(serial) || serial < 0 || serial > 2958465) return String(serial);
  const date = new Date(Math.round((serial - (date1904 ? 24107 : 25569)) * 86400000)).toISOString();
  if (Number.isInteger(serial)) return date.slice(0, 10);
  return serial < 1 ? date.slice(11, 19) : `${date.slice(0, 10)} ${date.slice(11, 19)}`;
}

function xlsxCsv(zip) {
  const targets = relationships(zip, "xl/_rels/workbook.xml.rels", "xl/");
  const names = [];
  let first = "", date1904 = false;
  walk(member(zip, "xl/workbook.xml"), {
    open(tag, attributes) {
      if (tag === "workbookPr") date1904 = ["1", "true"].includes(attribute(attributes, "date1904") ?? "");
      if (tag !== "sheet") return;
      names.push(attribute(attributes, "name") ?? "");
      if (!first) first = targets.get(attribute(attributes, "r:id") ?? "") ?? "";
    },
  });
  if (!first || !zip.sizes.has(first)) first = zip.names.find((name) => /^xl\/worksheets\/[^/]+\.xml$/.test(name)) ?? "";
  if (!first) throw new Error("no worksheet");

  // Shared strings: every <t> of an item but its phonetic guide.
  const shared = [];
  const strings = optional(zip, "xl/sharedStrings.xml");
  if (strings) {
    let item = null, inText = false, phonetic = 0;
    walk(strings, {
      open(tag) {
        if (tag === "si") item = [];
        else if (tag === "rPh") phonetic++;
        else if (tag === "t") inText = true;
      },
      close(tag) {
        if (tag === "si") { shared.push(item ? item.join("") : ""); item = null; }
        else if (tag === "rPh") phonetic--;
        else if (tag === "t") inText = false;
      },
      text(value) {
        if (inText && item && !phonetic) item.push(value);
      },
    });
  }

  // Which cell formats are dates, by the order cellXfs lists them in.
  const dateStyles = [];
  const stylesheet = optional(zip, "xl/styles.xml");
  if (stylesheet) {
    const custom = new Map();
    let inCellFormats = false;
    walk(stylesheet, {
      open(tag, attributes) {
        if (tag === "numFmt") custom.set(Number(attribute(attributes, "numFmtId")), attribute(attributes, "formatCode") ?? "");
        else if (tag === "cellXfs") inCellFormats = true;
        else if (tag === "xf" && inCellFormats) {
          const id = Number(attribute(attributes, "numFmtId") ?? 0);
          dateStyles.push(custom.has(id) ? isDateCode(custom.get(id)) : BUILTIN_DATES.has(id));
        }
      },
      close(tag) {
        if (tag === "cellXfs") inCellFormats = false;
      },
    });
  }

  const csv = new Csv();
  let cells = null, rowNumber = 0, column = -1, type = "", style = 0, value = null, capture = "";
  walk(member(zip, first), {
    open(tag, attributes) {
      if (tag === "row") {
        const number = Number(attribute(attributes, "r") ?? rowNumber + 1) || rowNumber + 1;
        // Rows the sheet leaves out are empty rows.
        for (let gap = Math.min(number - rowNumber - 1, COLUMN_CAP); gap > 0; gap--) csv.row([]);
        rowNumber = number;
        cells = [];
      } else if (tag === "c" && cells) {
        const reference = attribute(attributes, "r");
        column = reference ? columnOf(reference) : column + 1;
        type = attribute(attributes, "t") ?? "";
        style = Number(attribute(attributes, "s") ?? 0);
        value = null;
      } else if (cells && (tag === "v" || (tag === "t" && type === "inlineStr"))) capture = tag;
    },
    close(tag) {
      if (tag === capture) capture = "";
      else if (tag === "c" && cells) {
        if (value === null || column < 0 || column >= COLUMN_CAP) return;
        let text = value;
        if (type === "s") text = shared[Number(value)] ?? "";
        else if (type === "b") text = value === "1" ? "TRUE" : "FALSE";
        else if (type === "" || type === "n") {
          const number = Number(value);
          if (value.trim() !== "" && Number.isFinite(number)) text = dateStyles[style] ? serialDate(number, date1904) : String(number);
        }
        cells[column] = text;
      } else if (tag === "row" && cells) {
        csv.row(cells);
        cells = null;
        column = -1;
      }
    },
    text(text) {
      if (capture) value = (value ?? "") + text;
      return !csv.full;
    },
  });
  return csv.text(sheetNote(names));
}

function odsCsv(zip) {
  const names = [];
  const csv = new Csv();
  let depth = 0, sheet = 0, cells = null, rowRepeat = 1, cell = null, skip = 0;
  walk(member(zip, "content.xml"), {
    open(tag, attributes) {
      if (skip || ODF_SKIP.has(tag)) {
        skip++;
        return;
      }
      if (tag === "table:table") {
        // A table inside a cell belongs to that cell, not to the list of sheets.
        if (depth++ === 0) names.push(attribute(attributes, "table:name") ?? "");
        if (depth === 1) sheet = names.length;
      } else if (sheet !== 1 || depth !== 1) return;
      else if (tag === "table:table-row") {
        cells = [];
        rowRepeat = Math.max(1, Number(attribute(attributes, "table:number-rows-repeated") ?? 1) || 1);
      } else if ((tag === "table:table-cell" || tag === "table:covered-table-cell") && cells)
        cell = { repeat: Math.max(1, Number(attribute(attributes, "table:number-columns-repeated") ?? 1) || 1), lines: [], line: null };
      else if (tag === "text:p" && cell) cell.line = [];
      else if (tag === "text:s" && cell?.line) cell.line.push(" ".repeat(Math.min(64, Math.max(1, Number(attribute(attributes, "text:c") ?? 1) || 1))));
      else if (tag === "text:tab" && cell?.line) cell.line.push("\t");
      else if (tag === "text:line-break" && cell?.line) cell.line.push("\n");
    },
    close(tag) {
      if (skip) {
        skip--;
        return;
      }
      if (tag === "table:table") {
        depth--;
        return;
      }
      if (sheet !== 1 || depth !== 1) return;
      if (tag === "text:p" && cell?.line) {
        cell.lines.push(cell.line.join(""));
        cell.line = null;
      } else if ((tag === "table:table-cell" || tag === "table:covered-table-cell") && cell && cells) {
        const text = cell.lines.join("\n");
        // A repeated empty cell is the padding to the sheet's edge; only a filled one is copied.
        if (text === "") cells.length = Math.min(COLUMN_CAP, cells.length + cell.repeat);
        else for (let copy = Math.min(cell.repeat, COLUMN_CAP - cells.length); copy > 0; copy--) cells.push(text);
        cell = null;
      } else if (tag === "table:table-row" && cells) {
        const filled = cells.some((value) => value !== undefined && value !== "");
        // Empty rows repeated to the sheet's end only count as blanks; a filled row repeats as written.
        for (let copy = Math.min(rowRepeat, filled ? ROW_REPEAT_CAP : COLUMN_CAP); copy > 0 && !csv.full; copy--) csv.row(cells);
        cells = null;
      }
    },
    text(value) {
      if (!skip && cell?.line) cell.line.push(value);
      return !csv.full;
    },
  });
  if (!names.length) throw new Error("no sheet");
  return csv.text(sheetNote(names));
}

// ---- the preview ----

// The fragment's own text, for the source view and the line count.
const htmlText = (html) =>
  decode(
    html
      .replace(/<\/(p|h[1-6]|li|tr|table)>|<br>/g, "\n")
      .replace(/<\/td>/g, "\t")
      .replace(/<[^>]*>/g, "")
      .replace(/&nbsp;/g, " "),
  ).replace(/\t+\n/g, "\n").replace(/\n{3,}/g, "\n\n");

// What an archive preview lists: the first names and the count of the rest.
function memberNames(zip) {
  const names = zip.names.slice(0, NAME_CAP);
  return { names, more: zip.names.length - names.length };
}
function listingHtml(zip) {
  const { names, more } = memberNames(zip);
  return `<p>No readable text in this document. It contains:</p><ul>${names.map((name) => `<li>${escape(name)}</li>`).join("")}</ul>${more > 0 ? `<p>+ ${more} more</p>` : ""}`;
}
function listingCsv(zip) {
  const { names, more } = memberNames(zip);
  const lines = ["Member,Bytes", ...names.map((name) => `${field(name)},${zip.sizes.get(name)}`)];
  if (more > 0) lines.push(field(`+ ${more} more`));
  return lines.join("\n") + "\n";
}

function convert(path, kind) {
  const zip = openZip(path);
  try {
    const lower = path.toLowerCase();
    const open = lower.endsWith(".odt") || lower.endsWith(".odp") || lower.endsWith(".ods");
    if (kind === "sheet") {
      let csv = "";
      try {
        csv = open ? odsCsv(zip) : xlsxCsv(zip);
      } catch {}
      const listed = csv === "";
      if (listed) csv = listingCsv(zip);
      return { kind, csv, text: csv, listed };
    }
    let html = "";
    try {
      html = open ? odfHtml(zip, kind === "slides") : kind === "slides" ? pptxHtml(zip) : docxHtml(zip);
    } catch {}
    // A deck of empty slides is its headings alone, which says nothing either.
    const listed = html.replace(/<h2>Slide \d+<\/h2>/g, "") === "";
    if (listed) html = listingHtml(zip);
    return { kind, html, text: htmlText(html), listed };
  } finally {
    zip.close();
  }
}

// The column, its facts and Quick Look ask about the same file within moments of each other.
const CACHE_SIZE = 4;
const cache = new Map();

/** The preview of the office file at `path`: { kind, html?, csv?, text, listed }. `html` is a
 * fragment of the tags src/html.js keeps, `csv` the first sheet, `text` either one as plain lines,
 * and `listed` is true when the content could not be read and the zip's member names stand in.
 * Throws for a name this file does not read, a file over OFFICE_LIMIT, and a file that is not a zip
 * (a legacy binary document or an encrypted one). */
export function officePreview(path) {
  const kind = officeKind(path);
  if (!kind) throw new Error("not an office document");
  const st = statSync(path);
  if (!st.isFile()) throw new Error("not a file");
  if (st.size > OFFICE_LIMIT) throw new Error("office document too large");
  const key = `${path}\0${st.size}\0${st.mtimeMs}`;
  let preview = cache.get(key);
  if (!preview) {
    preview = convert(path, kind);
    cache.set(key, preview);
    if (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value);
  }
  return preview;
}
