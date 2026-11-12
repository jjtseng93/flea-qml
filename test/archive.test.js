import { test, expect, afterAll } from 'bun:test';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { listArchive } from '../src/archive.js';
const dir = mkdtempSync(join(tmpdir(), 'flea-archive-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
function header(name, size, type='0') {
  const b=Buffer.alloc(512); b.write(name); b.write(String(size),124,12); b.write(type,156);
  b.fill(32,148,156); const sum=b.reduce((a,v)=>a+v,0);
  b.write(sum.toString(8).padStart(6,'0')+'\0 ',148); return b;
}
async function read(bytes, ext='tar') {
  const path=join(dir, `${crypto.randomUUID()}.${ext}`); writeFileSync(path,bytes);
  const rows=[]; await listArchive(path,path,r=>rows.push(r)); return rows;
}
const valid=Buffer.concat([header('hello.txt','3'),Buffer.from('hey'),Buffer.alloc(509),Buffer.alloc(1024)]);
for (const format of ['tar','tgz','tzst']) test(`list ${format}`,async()=>{
  const bytes=format==='tar'?valid:format==='tgz'?gzipSync(valid):Bun.zstdCompressSync(valid);
  expect(await read(bytes,format)).toEqual([{name:'hello.txt',size:3,dir:false}]);
});
for (const size of ['-1000','77777777777']) test(`reject invalid or truncated tar size ${size}`,async()=>{
  await expect(read(header('bad',size))).rejects.toThrow();
});
test('reject truncated compressed member',async()=>{
  await expect(read(gzipSync(header('bad','1000')),'tgz')).rejects.toThrow();
});
test('cap extended metadata before allocation',async()=>{
  await expect(read(gzipSync(header('extended','10000000','x')),'tgz')).rejects.toThrow('too large');
});
test('reject partial trailing block',async()=>{await expect(read(Buffer.concat([valid,Buffer.from('bad')]))).rejects.toThrow();});
// One stored member: its local header and bytes, then the central directory and its end record.
const ZIP_CENTRAL=30+'hello'.length+3;
function zip(name='hello',size=3) {
  const l=Buffer.alloc(30); l.writeUInt32LE(0x04034b50); l.writeUInt32LE(size,18); l.writeUInt32LE(size,22); l.writeUInt16LE(name.length,26);
  const local=Buffer.concat([l,Buffer.from(name),Buffer.alloc(size,0x61)]);
  const h=Buffer.alloc(46); h.writeUInt32LE(0x02014b50); h.writeUInt32LE(size,20); h.writeUInt32LE(size,24); h.writeUInt16LE(name.length,28);
  const c=Buffer.concat([h,Buffer.from(name)]), e=Buffer.alloc(22);
  e.writeUInt32LE(0x06054b50);e.writeUInt16LE(1,8);e.writeUInt16LE(1,10);e.writeUInt32LE(c.length,12);e.writeUInt32LE(local.length,16);
  return Buffer.concat([local,c,e]);
}
test('zip central listing',async()=>{expect(await read(zip(),'zip')).toEqual([{name:'hello',size:3,dir:false}]);});
test('reject oversized central directory before allocation',async()=>{
  const b=zip(); b.writeUInt32LE(0xffffffff,b.length-10);
  await expect(read(b,'zip')).rejects.toThrow();
});
test('reject truncated central entry name',async()=>{
  const b=zip();b.writeUInt16LE(65000,ZIP_CENTRAL+28);await expect(read(b,'zip')).rejects.toThrow();
});
test('reject a split archive and a member outside the archive',async()=>{
  const split=zip();split.writeUInt16LE(1,split.length-18);await expect(read(split,'zip')).rejects.toThrow('split');
  const outside=zip();outside.writeUInt32LE(1000,ZIP_CENTRAL+42);await expect(read(outside,'zip')).rejects.toThrow('range');
  const wide=zip();wide.writeUInt32LE(0xffffffff,ZIP_CENTRAL+24);await expect(read(wide,'zip')).rejects.toThrow('zip64');
});
test('reject corrupt later tar header instead of partial success',async()=>{
  await expect(read(Buffer.concat([valid,Buffer.alloc(512,42)]))).rejects.toThrow();
});
function pax(key,value) {
 const body=` ${key}=${value}\n`;let n=body.length+1;
 while(String(n).length+body.length!==n)n=String(n).length+body.length;
 return Buffer.from(String(n)+body);
}
function member(name,body,type='0') {
 return Buffer.concat([header(name,body.length.toString(8),type),body,Buffer.alloc((512-body.length%512)%512)]);
}
test('pax metadata controls following file, including global headers',async()=>{
 const b=Buffer.concat([member('global',pax('path','global-name'),'g'),member('file',Buffer.from('a'))]);
 expect((await read(b))[0].name).toBe('global-name');
});
test('negative pax size is rejected for raw and compressed tar',async()=>{
 const b=Buffer.concat([member('pax',pax('size','-512'),'x'),header('file','0')]);
 await expect(read(b)).rejects.toThrow('size');await expect(read(gzipSync(b),'tgz')).rejects.toThrow('size');
});
test('meta never reports a corrupt partial listing as complete',async()=>{
 const {meta}=await import('../src/meta.js');const name='corrupt.tar';
 writeFileSync(join(dir,name),Buffer.concat([valid,Buffer.alloc(512,42)]));
 const result=await meta({path:dir,rows:[{name}]},{row:0,archive:true,token:42});
 expect(result.afailed).toBe(true);expect(result.entries).toBe(0);expect(result.names).toEqual([]);expect(result.token).toBe(42);
});
