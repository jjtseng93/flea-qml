import { test, expect } from 'bun:test';
async function load(name, names, deps = {}) {
  const source = (await Bun.file(new URL('../ui/js/' + name + '.js', import.meta.url)).text()).replace(/^\.(?:pragma|import).*$/gm, '');
  return new Function(...Object.keys(deps), source + ';return {' + names + '};')(...Object.values(deps));
}
const Format = await load('Format', 'fileUri');
const MdUrl = await load('MdUrl', 'classifyImage,isDataImage,MAX_DATA_IMAGE_CHARS', { Format, Ent: {} });
const Pictures = await load('MarkdownPictures', 'urls', { MdUrl });
const webp = 'data:image/webp;base64,UklGRhYAAABXRUJQVlA4TAoAAAAvAAAAAEX/I/of';

test('a base64 raster data: picture is kept as an image', () => {
  for (const type of ['png', 'jpeg', 'gif', 'webp', 'bmp']) {
    const url = `data:image/${type};base64,AAAA`;
    expect(MdUrl.classifyImage(url, '/docs')).toEqual({ kind: 'local', url });
  }
  expect(MdUrl.classifyImage(webp, '/docs')).toEqual({ kind: 'local', url: webp });
});

test('other data: pictures are dropped to their alt text', () => {
  for (const url of [
    'data:image/svg+xml;base64,PHN2Zz4=',            // SVG is a document, not a raster
    'data:image/png,%89PNG',                          // not base64
    'data:text/html;base64,PGgxPg==',                 // not an image
    'data:image/png;base64,AA AA',                    // not a base64 body
    'data:image/png;base64,' + 'A'.repeat(MdUrl.MAX_DATA_IMAGE_CHARS),  // past the size limit
  ]) {
    expect(MdUrl.classifyImage(url, '/docs')).toEqual({ kind: 'dropped' });
    expect(Pictures.urls(`![x](${url})`)).toEqual([]);
  }
});

test('file and remote images keep their classification', () => {
  expect(MdUrl.classifyImage('pic.png', '/docs')).toEqual({ kind: 'local', url: 'file:///docs/pic.png' });
  expect(MdUrl.classifyImage('https://x.test/p.png', '/docs')).toEqual({ kind: 'remote', host: 'x.test' });
  expect(MdUrl.classifyImage('../p.png', '/docs')).toEqual({ kind: 'dropped' });
});

test('inline data: pictures are measured like file pictures', () => {
  expect(Pictures.urls(`a ![x](${webp}) b ![y](file:///d/p.png) ![z](https://t.test/p.png)`)).toEqual([webp, 'file:///d/p.png']);
});

// The preview parses in ui/MarkdownWorker.js, which Qt.includes these files into one scope.
async function workerBlocks() {
  const ui = new URL('../ui/', import.meta.url);
  let src = await Bun.file(new URL('MarkdownWorker.js', ui)).text();
  const parts = [];
  for (const [, file] of src.matchAll(/^Qt\.include\("([^"]+)"\);$/gm)) parts.push((await Bun.file(new URL(file, ui)).text()).replace(/^\.(?:pragma|import).*$/gm, ''));
  src = src.replace(/^Qt\.include\("[^"]+"\);$/gm, '').replace(/WorkerScript\.onMessage[\s\S]*$/, '');
  return new Function('WorkerScript', parts.join('\n') + '\n' + src + '; return MdBlocks.blocks;')({ sendMessage() {} });
}

test('a data: picture longer than the ordinary target scan limit is still a picture block', async () => {
  const blocks = await workerBlocks();
  const big = 'data:image/webp;base64,' + 'A'.repeat(20000);
  const out = blocks(`# T\n\n![big](${big} "title")\n\n![small](pic.png)\n\n[link](${'x'.repeat(9000)})\n`, '/d', {}, {});
  const images = out.filter(b => b.type === 'image');
  expect(images.map(b => b.url)).toEqual([big, 'file:///d/pic.png']);
  // Other targets keep the scan limit: a 9000-character link stays literal text.
  expect(out.some(b => b.type === 'run' && b.text.includes('&#91;link&#93;('))).toBe(true);
});

test('the web preview keeps a data: picture and counts it against the picture budget', async () => {
  const { classifyImage } = await import('../src/markdown-html.js');
  const url = 'data:image/webp;base64,' + 'A'.repeat(4000);
  const budget = { left: 5000 };
  expect(classifyImage(url, '/tmp', budget)).toEqual({ kind: 'local', url });
  expect(budget.left).toBe(2000);
  expect(classifyImage(url, '/tmp', budget).kind).toBe('dropped'); // 3000 decoded bytes > 2000 left
  expect(classifyImage('data:image/svg+xml;base64,AAAA', '/tmp', { left: 1e6 }).kind).toBe('dropped');
  expect(classifyImage('data:text/html;base64,AAAA', '/tmp', { left: 1e6 }).kind).toBe('dropped');
});

test('a large-page request (buninu-browser) lets the pictures share 15 MB instead of 1 MB', async () => {
  const { markdownHtml, LARGE_PAGE_IMAGES_TOTAL } = await import('../src/markdown-html.js');
  const { mkdtempSync, rmSync, writeFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  const { tmpdir } = await import('node:os');
  expect(LARGE_PAGE_IMAGES_TOTAL).toBe(15 << 20);
  const dir = mkdtempSync(join(tmpdir(), 'flea-md-budget-'));
  try {
    // Three 600 KB pictures: one fits 1 MB, all three fit 15 MB.
    for (const n of [1, 2, 3]) writeFileSync(join(dir, `p${n}.png`), new Uint8Array(600 * 1024));
    const source = '![a](p1.png)\n\n![b](p2.png)\n\n![c](p3.png)\n';
    const pictures = reply => (reply.html.match(/<img[^>]*src="data:image\/png;base64,/g) ?? []).length;
    const plain = await markdownHtml({ path: join(dir, 'a.md'), source, token: 1 });
    const large = await markdownHtml({ path: join(dir, 'a.md'), source, token: 2, largePage: true });
    expect(plain.state).toBe('ready');
    expect(large.state).toBe('ready');
    expect(pictures(plain)).toBe(1);
    expect(pictures(large)).toBe(3);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('under buninu-browser a Markdown file may grow to 22 MB; under Qt it stays a text file', async () => {
  const withNavigator = navigator => load('ExtThumbs', 'markdownLimit,textLimit', { Thumbs: {}, Format: {}, navigator });
  const buninu = await withNavigator({ buninu: {} });
  const qt = await withNavigator(undefined);
  expect(buninu.markdownLimit('local')).toBe(22 << 20);
  expect(buninu.markdownLimit('phone')).toBe(262144); // remote storage keeps its 256 KiB read
  expect(qt.markdownLimit('local')).toBe(qt.textLimit('local'));
  expect(qt.markdownLimit('local')).toBe(1 << 20);
});

test('a large-page request takes 15 MB of inline data: pictures but still only 1 MB of text', async () => {
  const { markdownHtml, LARGE_MARKDOWN_FILE } = await import('../src/markdown-html.js');
  const { mkdtempSync, rmSync, writeFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  const { tmpdir } = await import('node:os');
  const dir = mkdtempSync(join(tmpdir(), 'flea-md-inline-'));
  try {
    // 20 inline pictures of 700 KB decoded (about 13.7 MB, 18.2 MB of base64) in an 18 MB file.
    const picture = `data:image/png;base64,${Buffer.alloc(700 * 1024, 7).toString('base64')}`;
    const source = Array.from({ length: 20 }, (_, i) => `![p${i}](${picture})`).join('\n\n') + '\n';
    expect(Buffer.byteLength(source)).toBeGreaterThan(1 << 20);
    expect(Buffer.byteLength(source)).toBeLessThan(LARGE_MARKDOWN_FILE);
    const file = join(dir, 'a.md');
    writeFileSync(file, source);
    const pictures = reply => (reply.html.match(/<img[^>]*src="data:image\/png;base64,/g) ?? []).length;
    expect((await markdownHtml({ path: file, token: 1 })).state).toBe('failed'); // Qt: over 1 MB
    const large = await markdownHtml({ path: file, token: 2, largePage: true });
    expect(large.state).toBe('ready');
    expect(pictures(large)).toBe(20);
    // 22 pictures pass 15 MB: the last ones fall back to their alt text.
    const over = Array.from({ length: 22 }, (_, i) => `![q${i}](${picture})`).join('\n\n') + '\n';
    writeFileSync(file, over);
    const capped = await markdownHtml({ path: file, token: 3, largePage: true });
    expect(capped.state).toBe('ready');
    expect(pictures(capped)).toBe(21); // 21 × 700 KB = 14.4 MB fits, the 22nd does not
    // Plain text over 1 MB is refused even for a large page.
    writeFileSync(file, 'word '.repeat(300 * 1024));
    expect((await markdownHtml({ path: file, token: 4, largePage: true })).state).toBe('failed');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('literal data URLs count as text even when another copy is an image', async () => {
  const { markdownHtml } = await import('../src/markdown-html.js');
  const url = 'data:image/png;base64,' + 'A'.repeat(1 << 20);
  for (const literal of [url, '```\n' + url + '\n```', '`' + url + '`']) {
    const source = '![picture](' + url + ')\n\n' + literal;
    expect((await markdownHtml({ path: '/docs/a.md', source, largePage: true })).state).toBe('failed');
  }
});

test('reference images spend decoded bytes for each use, including padded base64', async () => {
  const { markdownPage, classifyImage } = await import('../src/markdown-html.js');
  const url = 'data:image/png;base64,YQ==';
  expect(classifyImage(url, '.', { left: 1 }).kind).toBe('local');
  const html = markdownPage('![a][pic] ![b][pic]\n\n[pic]: ' + url, '.', {}, [], 1);
  expect(html.split(url)).toHaveLength(2);
});
