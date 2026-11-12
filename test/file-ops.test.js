import { test, expect, afterAll } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, readdirSync, lstatSync, readlinkSync, symlinkSync, statSync, chmodSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdir, newfile, duplicate } from '../src/create.js';
import { bulkrename } from '../src/bulkrename.js';
import { permissions, permissionsBatch, parseMode } from '../src/permissions.js';
import { archive, archiveCancel, formats, freeName } from '../src/archiveops.js';
import { listArchive } from '../src/archive.js';
import { openSync, closeSync } from 'node:fs';

const root = mkdtempSync(join(tmpdir(), 'flea-ops-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));
let n = 0;
const fresh = () => { const dir = join(root, `case-${++n}`); mkdirSync(dir); return dir; };
// PRoot resolves links itself, so an exclusive create there follows a dangling link; the kernel never does.
const exclusiveRefusesLinks = (() => {
  const dir = mkdtempSync(join(tmpdir(), 'flea-excl-'));
  try {
    symlinkSync(join(dir, 'absent'), join(dir, 'link'));
    try { closeSync(openSync(join(dir, 'link'), 'wx')); return false; } catch { return true; }
  } finally { rmSync(dir, { recursive: true, force: true }); }
})();
const umask = process.umask();
const collector = () => { const lines = []; const send = (line) => lines.push(line); return { lines, send }; };
// Resolves with the first line `pick` accepts, waiting for the asynchronous operations.
async function until(lines, pick, ms = 10000) {
  const end = Date.now() + ms;
  for (;;) {
    const found = lines.find(pick);
    if (found) return found;
    if (Date.now() > end) throw Error(`no line arrived: ${JSON.stringify(lines)}`);
    await Bun.sleep(10);
  }
}

test('mkdir takes the first free New Folder and refuses a typed name already taken', () => {
  const dir = fresh(), { lines, send } = collector();
  mkdir({ path: dir }, send);
  mkdir({ path: dir }, send);
  expect(lines.filter((l) => l.t === 'made').map((l) => l.path)).toEqual([join(dir, 'New Folder'), join(dir, 'New Folder 2')]);
  writeFileSync(join(dir, '報告'), '');
  mkdir({ path: dir, name: '報告' }, send);
  expect(lines.at(-1)).toMatchObject({ t: 'error', where: 'mkdir', msg: 'a folder or file with that name already exists' });
  mkdir({ path: dir, name: '../x' }, send);
  expect(lines.at(-1)).toMatchObject({ t: 'error', where: 'mkdir' });
  mkdir({ path: 'relative' }, send);
  expect(lines.at(-1).t).toBe('error');
});

test('mkdir with a request id adds the creation receipt', () => {
  const dir = fresh(), { lines, send } = collector();
  mkdir({ path: dir, name: 'a', request: 4 }, send);
  expect(lines[0]).toMatchObject({ t: 'made', ok: true, request: 4 });
  expect(lines[1]).toEqual({ t: 'menuaction', op: 'creation', id: 4, kind: 'made', ok: true, path: join(dir, 'a') });
});

test('newfile creates an empty file exclusively and never follows a dangling link', () => {
  const dir = fresh(), { lines, send } = collector();
  newfile({ id: 3, path: dir, name: 'New File 🙂' }, send);
  expect(lines[0]).toEqual({ t: 'menuaction', id: 3, op: 'newFile', ok: true, path: join(dir, 'New File 🙂') });
  expect(statSync(join(dir, 'New File 🙂')).size).toBe(0);
  newfile({ id: 3, path: dir, name: 'New File 🙂' }, send);
  expect(lines.at(-1)).toMatchObject({ op: 'newFile', ok: false });
  if (exclusiveRefusesLinks) {
    symlinkSync(join(dir, 'absent'), join(dir, 'link'));
    newfile({ id: 3, path: dir, name: 'link' }, send);
    expect(lines.at(-1).ok).toBe(false);
    expect(existsSync(join(dir, 'absent'))).toBe(false);
  }
  newfile({ id: 3, path: dir, name: 'a/b' }, send);
  expect(lines.at(-1).ok).toBe(false);
});

test('duplicate copies a file and a tree to free copy names', async () => {
  const dir = fresh(), { lines, send } = collector();
  writeFileSync(join(dir, 'backup.tar.zst'), 'x');
  mkdirSync(join(dir, 'tree/inner'), { recursive: true });
  writeFileSync(join(dir, 'tree/inner/f'), 'deep');
  duplicate({ path: join(dir, 'backup.tar.zst') }, send);
  duplicate({ path: join(dir, 'backup.tar.zst') }, send);
  duplicate({ path: join(dir, 'tree') }, send);
  await until(lines, (l) => l.t === 'duplicated' && l.path.endsWith('tree copy'));
  expect(lines.filter((l) => l.t === 'duplicated').map((l) => l.path)).toEqual(
    [join(dir, 'backup.tar copy.zst'), join(dir, 'backup.tar copy 2.zst'), join(dir, 'tree copy')]);
  expect(readFileSync(join(dir, 'tree copy/inner/f'), 'utf8')).toBe('deep');
});

test('bulkrename swaps names through temporary names and refuses a bad batch whole', () => {
  const dir = fresh(), { lines, send } = collector();
  writeFileSync(join(dir, 'a'), 'A');
  writeFileSync(join(dir, 'b'), 'B');
  writeFileSync(join(dir, 'c'), 'C');
  bulkrename({ paths: [join(dir, 'a'), join(dir, 'b'), join(dir, 'c')], names: ['b', 'a', 'c'] }, send);
  expect(lines[0]).toEqual({ t: 'bulkrenamed', ok: 2, unchanged: 1 });
  expect(readFileSync(join(dir, 'a'), 'utf8')).toBe('B');
  expect(readFileSync(join(dir, 'b'), 'utf8')).toBe('A');
  for (const names of [['x', 'x', 'y'], ['c', 'q'], ['ok', 'a/b', 'z'], ['', 'm', 'n']]) {
    bulkrename({ paths: [join(dir, 'a'), join(dir, 'b'), join(dir, 'c')].slice(0, names.length), names }, send);
    expect(lines.at(-1)).toMatchObject({ t: 'error', where: 'bulkrename' });
  }
  expect(readdirSync(dir).sort()).toEqual(['a', 'b', 'c']);
});

test('permissions inspects, applies and refuses a replaced item', () => {
  if (process.platform === 'win32') return;
  const dir = fresh(), path = join(dir, 'f'), { lines, send } = collector();
  writeFileSync(path, '');
  chmodSync(path, 0o644);
  permissions({ op: 'inspect', id: 1, path }, send);
  expect(lines[0]).toMatchObject({ t: 'permissions', id: 1, op: 'inspect', ok: true, mode: '0644', directory: false, reason: '' });
  permissions({ op: 'apply', id: 1, mode: '600' }, send);
  expect(lines.at(-1)).toEqual({ t: 'permissions', id: 1, op: 'apply', ok: true, mode: '0600' });
  expect(statSync(path).mode & 0o777).toBe(0o600);
  permissions({ op: 'apply', id: 1, mode: '9' }, send);
  expect(lines.at(-1).error).toMatch(/octal/);
  rmSync(path);
  writeFileSync(path, '');
  permissions({ op: 'apply', id: 1, mode: '644' }, send);
  expect(lines.at(-1)).toMatchObject({ ok: false, error: 'Selected item changed; reopen Permissions.' });
  expect(() => parseMode('1644')).toThrow();
  expect(parseMode('0755')).toBe(0o755);
});

test('permissionsBatch changes every item or none, and u+x adds the owner execute bit', () => {
  if (process.platform === 'win32') return;
  const dir = fresh(), a = join(dir, 'a'), b = join(dir, 'b'), { lines, send } = collector();
  writeFileSync(a, '');
  writeFileSync(b, '');
  chmodSync(a, 0o644);
  chmodSync(b, 0o640);
  permissionsBatch({ id: 7, paths: [a, b], modes: ['u+x', 'u+x'] }, send);
  expect(lines.at(-1)).toMatchObject({ op: 'applyMany', ok: true });
  expect([statSync(a).mode & 0o777, statSync(b).mode & 0o777]).toEqual([0o744, 0o740]);
  permissionsBatch({ id: 8, paths: [a, join(dir, 'gone')], modes: ['600', '600'] }, send);
  expect(lines.at(-1)).toMatchObject({ op: 'applyMany', ok: false });
  expect(statSync(a).mode & 0o777).toBe(0o744);
});

test('formats names what this port writes and reads, and no password', () => {
  const { lines, send } = collector();
  formats({ id: 2 }, send);
  expect(lines[0]).toMatchObject({ t: 'formats', archive: ['zip', 'tar', 'tar.gz', 'tar.zst'], convert: false,
    extract: { archive: true, sevenZip: false, zip: true } });
});

test('free archive names keep the format tail', () => {
  expect(freeName('/a/pack.tar.gz', 'tar.gz', 1)).toBe('/a/pack copy.tar.gz');
  expect(freeName('/a/pack.tar.gz', 'tar.gz', 2)).toBe('/a/pack copy 2.tar.gz');
  expect(freeName('/a/folder', null, 1)).toBe('/a/folder copy');
});

// A tree with Chinese and emoji names, a long path, a symlink, an empty folder and a non-default mode.
function sampleTree(dir) {
  const top = join(dir, '專案 📦');
  const long = join(top, 'd'.repeat(60), 'e'.repeat(60));
  mkdirSync(long, { recursive: true });
  mkdirSync(join(top, 'empty'));
  writeFileSync(join(top, '說明.txt'), '你好 👋\n');
  writeFileSync(join(long, 'f'.repeat(90) + '.bin'), Buffer.alloc(300000, 7));
  writeFileSync(join(top, 'run.sh'), '#!/bin/sh\n');
  chmodSync(join(top, 'run.sh'), 0o755);
  symlinkSync('說明.txt', join(top, 'readme'));
  return top;
}
// Extracted modes pass through the umask, as bsdtar's do for anyone but root.
function expectSameTree(a, b) {
  const walk = (base, rel = '', mask = 0) => readdirSync(join(base, rel)).sort().flatMap((name) => {
    const path = join(base, rel, name), st = lstatSync(path), key = join(rel, name);
    if (st.isSymbolicLink()) return [[key, 'link', readlinkSync(path)]];
    if (st.isDirectory()) return [[key, 'dir'], ...walk(base, key, mask)];
    return [[key, (st.mode & 0o777 & ~mask).toString(8), readFileSync(path).toString('base64')]];
  });
  expect(walk(b)).toEqual(walk(a, '', umask));
}

for (const format of ['zip', 'tar', 'tar.gz', 'tar.zst']) {
  test(`compress to .${format} and extract it back to the same tree`, async () => {
    const dir = fresh(), top = sampleTree(dir), { lines, send } = collector();
    archive({ op: 'compress', paths: [top], dest: join(dir, `專案 📦.${format}`), format }, send);
    const done = await until(lines, (l) => l.t === 'archivedone');
    expect(done).toMatchObject({ ok: true, err: '', path: join(dir, `專案 📦.${format}`) });
    // The preview's own reader lists what was written.
    const names = [];
    await listArchive(done.path, done.path, (entry) => names.push(entry.name));
    expect(names).toContain('專案 📦/說明.txt');
    expect(names.some((name) => name.endsWith('f'.repeat(90) + '.bin'))).toBe(true);
    const out = join(dir, 'out');
    archive({ op: 'extract', path: done.path, dest: out }, send);
    const extracted = await until(lines, (l) => l.t === 'archivedone' && l.dest);
    expect(extracted).toMatchObject({ ok: true, dest: out });
    expect(lines.some((l) => l.t === 'extractstarted')).toBe(true);
    expectSameTree(top, join(out, '專案 📦'));
    // A second compress of the same name lands under its copy name.
    archive({ op: 'compress', paths: [top], dest: join(dir, `專案 📦.${format}`), format }, send);
    const again = await until(lines, (l) => l.t === 'archivedone' && l.path?.includes('copy'));
    expect(again.path).toBe(join(dir, `專案 📦 copy.${format}`));
    expect(readdirSync(dir).filter((name) => name.startsWith('.flea-work'))).toEqual([]);
  });
}

test('an archive that names a path outside its folder extracts nothing', async () => {
  const dir = fresh(), { lines, send } = collector();
  // A tar whose only member is ../escape.
  const header = Buffer.alloc(512);
  header.write('../escape', 0);
  header.write('0000644\0', 100); header.write('0000000\0', 108); header.write('0000000\0', 116);
  header.write('00000000003\0', 124); header.write('00000000000\0', 136);
  header.fill(0x20, 148, 156); header[156] = 0x30; header.write('ustar\0', 257); header.write('00', 263);
  let sum = 0; for (const byte of header) sum += byte;
  header.write(sum.toString(8).padStart(6, '0') + '\0 ', 148);
  const data = Buffer.alloc(512); data.write('bad');
  writeFileSync(join(dir, 'evil.tar'), Buffer.concat([header, data, Buffer.alloc(1024)]));
  archive({ op: 'extract', path: join(dir, 'evil.tar'), dest: join(dir, 'evil') }, send);
  const done = await until(lines, (l) => l.t === 'archivedone');
  expect(done.ok).toBe(false);
  expect(done.err).toMatch(/outside its folder/);
  expect(readdirSync(dir).sort()).toEqual(['evil.tar']);
  expect(existsSync(join(root, 'escape'))).toBe(false);
});

test('a password, a format it cannot read and a disk image are refused without starting', () => {
  const { lines, send } = collector();
  archive({ op: 'extract', path: '/x/a.zip', dest: '/x/a', password: 'p' }, send);
  archive({ op: 'extract', path: '/x/a.7z', dest: '/x/a' }, send);
  archive({ op: 'extract', path: '/x/a.iso', dest: '/x/a' }, send);
  expect(lines.every((l) => l.t === 'archivedone' && l.ok === false)).toBe(true);
  expect(lines.length).toBe(3);
});

test('cancelling a compress removes its staging file', async () => {
  const dir = fresh(), { lines, send } = collector();
  mkdirSync(join(dir, 'big'));
  for (let i = 0; i < 20; i++) writeFileSync(join(dir, 'big', `f${i}`), Buffer.alloc(2 << 20, i));
  archive({ op: 'compress', paths: [join(dir, 'big')], dest: join(dir, 'big.zip'), format: 'zip' }, send);
  const started = await until(lines, (l) => l.t === 'archivestarted');
  expect(archiveCancel(started.id)).toBe(true);
  const done = await until(lines, (l) => l.t === 'archivedone');
  expect(done).toMatchObject({ ok: false, err: 'cancelled' });
  expect(readdirSync(dir)).toEqual(['big']);
});
