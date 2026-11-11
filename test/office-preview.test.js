import { test, expect, afterAll } from 'bun:test';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateRawSync } from 'node:zlib';
import { officeKind, officePreview } from '../src/office.js';
import { html, previewHtml } from '../src/html.js';
import { code } from '../src/code.js';

const dir = mkdtempSync(join(tmpdir(), 'flea-office-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

// A zip of the given members, deflated unless `store`; CRCs are zero because nothing here checks them.
function zip(members, store = false) {
  const locals = [], centrals = [];
  let offset = 0;
  for (const [name, content] of Object.entries(members)) {
    const raw = Buffer.from(content), data = store ? raw : deflateRawSync(raw), id = Buffer.from(name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(store ? 0 : 8, 8);
    local.writeUInt32LE(data.length, 18); local.writeUInt32LE(raw.length, 22); local.writeUInt16LE(id.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6);
    central.writeUInt16LE(store ? 0 : 8, 10); central.writeUInt32LE(data.length, 20); central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(id.length, 28); central.writeUInt32LE(offset, 42);
    locals.push(local, id, data); centrals.push(central, id);
    offset += 30 + id.length + data.length;
  }
  const directory = Buffer.concat(centrals), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(Object.keys(members).length, 8); end.writeUInt16LE(Object.keys(members).length, 10);
  end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}
const file = (name, bytes) => { const path = join(dir, name); writeFileSync(path, bytes); return path; };

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const docx = {
  'word/styles.xml': `<w:styles ${W}><w:style w:type="paragraph" w:styleId="Kop1"><w:name w:val="heading 1"/></w:style><w:style w:type="paragraph" w:styleId="T"><w:name w:val="Title"/></w:style></w:styles>`,
  'word/numbering.xml': `<w:numbering ${W}><w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:numFmt w:val="bullet"/></w:lvl></w:abstractNum><w:abstractNum w:abstractNumId="1"><w:lvl w:ilvl="0"><w:numFmt w:val="decimal"/></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num><w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num></w:numbering>`,
  'word/document.xml': `<?xml version="1.0"?><w:document ${W}><w:body>
    <w:p><w:pPr><w:pStyle w:val="Kop1"/><w:rPr><w:b/></w:rPr></w:pPr><w:r><w:t>Report &amp; plan</w:t></w:r></w:p>
    <w:p><w:r><w:t xml:space="preserve">Plain </w:t></w:r><w:r><w:rPr><w:b/><w:i w:val="0"/></w:rPr><w:t>bold</w:t></w:r><w:r><w:rPr><w:i/><w:u w:val="single"/></w:rPr><w:t> a&lt;b</w:t></w:r><w:r><w:rPr><w:vertAlign w:val="superscript"/></w:rPr><w:t>2</w:t></w:r></w:p>
    <w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>one</w:t></w:r></w:p>
    <w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>two</w:t></w:r></w:p>
    <w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="2"/></w:numPr></w:pPr><w:r><w:t>first</w:t></w:r></w:p>
    <w:tbl><w:tr><w:tc><w:p><w:r><w:t>A1</w:t></w:r></w:p><w:p><w:r><w:t>line</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>B1</w:t></w:r></w:p></w:tc></w:tr></w:tbl>
    <w:p><w:r><w:t>kept</w:t></w:r><w:del><w:r><w:delText>removed</w:delText></w:r></w:del><w:r><w:instrText>PAGE</w:instrText></w:r><w:r><w:br/><w:t>next</w:t><w:tab/><w:t>col</w:t></w:r></w:p>
    <w:p/>
  </w:body></w:document>`,
};

test('office names are told apart by extension', () => {
  expect(['a.DOCX', 'b.odt', 'c.pptx', 'd.odp', 'e.xlsx', 'f.ods', 'g.doc', 'h.zip', 'docx'].map(officeKind))
    .toEqual(['document', 'document', 'slides', 'slides', 'sheet', 'sheet', '', '', '']);
});

test('DOCX becomes headings, emphasis, lists and tables in the fixed tags', () => {
  const preview = officePreview(file('rich.docx', zip(docx)));
  expect(preview.listed).toBe(false);
  expect(preview.html).toBe('<h1>Report &amp; plan</h1><p>Plain <b>bold</b><u><i> a&lt;b</i></u><sup>2</sup></p>'
    + '<ul><li>one</li><li>two</li></ul><ol><li>first</li></ol>'
    + '<table><tr><td>A1<br>line</td><td>B1</td></tr></table>'
    + '<p>kept<br>next&nbsp;&nbsp;&nbsp;&nbsp;col</p>');
  // The fragment survives the HTML preview's own rebuild unchanged, so every tag is one it keeps.
  expect(previewHtml(preview.html)).toBe(preview.html);
  expect(preview.text).toBe('Report & plan\nPlain bold a<b2\none\ntwo\nfirst\nA1\nline\tB1\n\nkept\nnext    col\n');
});

test('the html and code requests answer a DOCX from its text, stored or deflated', async () => {
  const path = file('stored.docx', zip(docx, true));
  expect(await html({ path, token: 3, slot: 'column' })).toMatchObject({ state: 'ready', token: 3, total: 9, html: officePreview(path).html });
  const reply = await code({ path, first: 1, count: 2 });
  expect(reply).toMatchObject({ state: 'plain', total: 10, lines: [[0, 'Report & plan'], [0, 'Plain bold a<b2']] });
});

test('PPTX slides follow the presentation order, with titles and tables', () => {
  const slide = (title, body) => `<p:sld><p:sp><p:nvSpPr><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:txBody><a:p><a:r><a:t>${title}</a:t></a:r></a:p></p:txBody></p:sp>`
    + `<p:sp><p:nvSpPr><p:nvPr><p:ph idx="1"/></p:nvPr></p:nvSpPr><p:txBody><a:p><a:r><a:rPr b="1"/><a:t>${body}</a:t></a:r><a:br/><a:r><a:t>more</a:t></a:r></a:p></p:txBody></p:sp></p:sld>`;
  const preview = officePreview(file('deck.pptx', zip({
    'ppt/presentation.xml': '<p:presentation><p:sldIdLst><p:sldId id="1" r:id="rId2"/><p:sldId id="2" r:id="rId1"/></p:sldIdLst></p:presentation>',
    'ppt/_rels/presentation.xml.rels': '<Relationships><Relationship Id="rId1" Target="slides/slide1.xml"/><Relationship Id="rId2" Target="slides/slide2.xml"/></Relationships>',
    'ppt/slides/slide1.xml': slide('Second', 'b'),
    'ppt/slides/slide2.xml': slide('First', 'a'),
  })));
  expect(preview.html).toBe('<h2>Slide 1</h2><h3>First</h3><p><b>a</b><br>more</p><h2>Slide 2</h2><h3>Second</h3><p><b>b</b><br>more</p>');
});

test('ODT reads headings, styled spans, lists and tables, without tracked changes or notes', () => {
  const preview = officePreview(file('text.odt', zip({ 'content.xml': `<office:document-content>
    <office:automatic-styles><style:style style:name="T1" style:family="text"><style:text-properties fo:font-weight="bold" fo:font-style="italic"/></style:style></office:automatic-styles>
    <office:body><office:text><text:tracked-changes><text:p>gone</text:p></text:tracked-changes>
    <text:h text:outline-level="2">Head</text:h>
    <text:p>a<text:span text:style-name="T1">b</text:span><text:s text:c="2"/>c<text:note><text:p>foot</text:p></text:note><text:line-break/>d</text:p>
    <text:list><text:list-item><text:p>x</text:p></text:list-item><text:list-item><text:p>y</text:p></text:list-item></text:list>
    <table:table><table:table-row><table:table-cell><text:p>1</text:p></table:table-cell><table:table-cell><text:p>2</text:p></table:table-cell></table:table-row></table:table>
    </office:text></office:body></office:document-content>` })));
  expect(preview.html).toBe('<h2>Head</h2><p>a<i><b>b</b></i>&nbsp;&nbsp;c<br>d</p><ul><li>x</li><li>y</li></ul><table><tr><td>1</td><td>2</td></tr></table>');
});

test('XLSX answers its first sheet as CSV: shared strings, dates, booleans, gaps and quoting', async () => {
  const path = file('book.xlsx', zip({
    'xl/workbook.xml': '<workbook><sheets><sheet name="Second" sheetId="2" r:id="rId2"/><sheet name="Other" sheetId="1" r:id="rId1"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels': '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Target="/xl/worksheets/sheet2.xml"/></Relationships>',
    'xl/sharedStrings.xml': '<sst><si><t>Name</t></si><si><r><t>Say </t></r><r><t>"hi", ok</t></r><rPh><t>skip</t></rPh></si></sst>',
    'xl/styles.xml': '<styleSheet><numFmts><numFmt numFmtId="164" formatCode="yyyy\\-mm\\-dd"/></numFmts><cellStyleXfs><xf numFmtId="14"/></cellStyleXfs><cellXfs><xf numFmtId="0"/><xf numFmtId="164"/><xf numFmtId="20"/></cellXfs></styleSheet>',
    'xl/worksheets/sheet1.xml': '<worksheet><sheetData><row r="1"><c r="A1"><v>wrong sheet</v></c></row></sheetData></worksheet>',
    'xl/worksheets/sheet2.xml': '<worksheet><sheetData>'
      + '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="C1" t="inlineStr"><is><t>When</t></is></c></row>'
      + '<row r="2"><c r="A2" t="s"><v>1</v></c><c r="B2"><v>1.50</v></c><c r="C2" s="1"><v>45000</v></c><c r="D2" t="b"><v>1</v></c><c r="E2" s="2"><v>0.5</v></c></row>'
      + '<row r="4"><c r="B4" t="str"><f>A1</f><v>calc</v></c></row>'
      + '</sheetData></worksheet>',
  }));
  const preview = officePreview(path);
  expect(preview.csv).toBe('Name,,When\n"Say ""hi"", ok",1.5,2023-03-15,TRUE,12:00:00\n\n,calc\n[Sheet 1 of 2: Second. The other sheets are not shown.]\n');
  // The table asks by record; the quoted record and the count come back whole.
  expect(await code({ path, raw: true, csv: ',', record: 2, count: 1 })).toMatchObject({ first: 2, records: 5, firstRecord: 2, lines: [[0, '"Say ""hi"", ok",1.5,2023-03-15,TRUE,12:00:00']] });
});

test('ODS repeats filled cells and ignores the padding to the sheet edge', () => {
  const preview = officePreview(file('sheet.ods', zip({ 'content.xml': `<office:document-content><office:body><office:spreadsheet>
    <table:table table:name="S"><table:table-row><table:table-cell table:number-columns-repeated="2"><text:p>x</text:p></table:table-cell><table:table-cell table:number-columns-repeated="16382"/></table:table-row>
    <table:table-row table:number-rows-repeated="2"><table:table-cell/></table:table-row>
    <table:table-row><table:table-cell/><table:table-cell><text:p>a, b</text:p><text:p>c</text:p></table:table-cell></table:table-row>
    <table:table-row table:number-rows-repeated="1048570"><table:table-cell table:number-columns-repeated="16384"/></table:table-row></table:table>
    </office:spreadsheet></office:body></office:document-content>` })));
  expect(preview.csv).toBe('x,x\n\n\n,"a, b\nc"\n');
});

test('a container with no readable content lists its members, and a non-zip is refused', async () => {
  const empty = officePreview(file('empty.docx', zip({ '[Content_Types].xml': '<Types/>', 'word/other.xml': '<x/>' })));
  expect(empty).toMatchObject({ listed: true, html: '<p>No readable text in this document. It contains:</p><ul><li>[Content_Types].xml</li><li>word/other.xml</li></ul>' });
  const sheet = officePreview(file('empty.xlsx', zip({ 'a&b.bin': 'xyz' })));
  expect(sheet).toMatchObject({ listed: true, csv: 'Member,Bytes\na&b.bin,3\n' });
  const legacy = file('legacy.docx', Buffer.from('\xd0\xcf\x11\xe0 not a zip', 'latin1'));
  expect(() => officePreview(legacy)).toThrow();
  expect((await html({ path: legacy, token: 1, slot: 'x' })).state).toBe('failed');
  expect((await code({ path: legacy })).state).toBe('failed');
});

test('hostile XML is neither expanded nor passed through', () => {
  const bomb = officePreview(file('bomb.docx', zip({ 'word/document.xml': '<!DOCTYPE d [<!ENTITY a "aaaa">]><w:document><w:body><w:p><w:r><w:t>&a;</w:t></w:r></w:p></w:body></w:document>' })));
  expect(bomb.listed).toBe(true);
  const markup = officePreview(file('markup.docx', zip({ 'word/document.xml': '<w:document><w:body><w:p><w:r><w:t>&lt;script&gt;x&lt;/script&gt; &#60;img&#62; &amp;amp;</w:t></w:r></w:p></w:body></w:document>' })));
  expect(markup.html).toBe('<p>&lt;script&gt;x&lt;/script&gt; &lt;img&gt; &amp;amp;</p>');
  expect(previewHtml(markup.html)).toBe(markup.html);
});

test('a long document stops at the output limit with balanced tags', () => {
  const paragraph = `<w:p><w:r><w:t>${'word '.repeat(200)}</w:t></w:r></w:p>`;
  const preview = officePreview(file('long.docx', zip({ 'word/document.xml': `<w:document><w:body>${paragraph.repeat(2000)}</w:body></w:document>` })));
  expect(preview.html.length).toBeLessThan(1 << 20);
  expect(preview.html.endsWith('<p>[Preview truncated]</p>')).toBe(true);
  expect(previewHtml(preview.html)).toBe(preview.html);
});
