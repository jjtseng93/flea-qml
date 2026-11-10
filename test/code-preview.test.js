import {test,expect} from 'bun:test';
import {mkdtempSync,writeFileSync,openSync,ftruncateSync,closeSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {code} from '../src/code.js';
const text=reply=>reply.lines.map(r=>r.filter((_,i)=>i%2).join('')).join('\n');
test('unknown binary files remain viewable with visible control characters',async()=>{
 const r=await code({text:'first\0second\x1b[31m\nlast',raw:true});
 expect(r.state).toBe('plain');expect(text(r)).toBe('first␀second␛[31m\nlast');
});
test('large sparse files read only their prefix and split pathological lines',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'flea-preview-'));
 try {
  const path=join(dir,'large.unknown');writeFileSync(path,'start\n');
  const fd=openSync(path,'r+');try{ftruncateSync(fd,1024*1024*1024);}finally{closeSync(fd);}
  const r=await code({path,count:400});
  expect(r.state).toBe('plain');expect(r.lines[0]).toEqual([0,'start']);
  expect(r.total).toBeLessThan(400);
  expect(text(r)).toContain('[Preview truncated: first 1 MiB]');
  expect(text(r)).toContain('[Long lines split for preview]');
  expect(r.lines.every(line=>line.length<3 && (line[1]?.length??0)<=4096)).toBe(true);
 } finally {rmSync(dir,{recursive:true,force:true});}
});
test('prefix windows stay addressable and empty files remain empty',async()=>{
 expect((await code({text:'',raw:true})).total).toBe(0);
 const r=await code({text:'one\ntwo\nthree\n',first:2,count:1,raw:true});
 expect(r.total).toBe(3);expect(text(r)).toBe('two');
});
test('unrecognized types reach text preview while media keeps its own viewer',async()=>{
 const source=(await Bun.file(new URL('../ui/js/Kinds.js',import.meta.url)).text()).replace(/^\.(?:pragma|import).*$/gm,'');
 const kinds=new Function('Archive','Format',source+';return {kindState,quickLookKind};')({isArchive:()=>false},{});
 expect(kinds.kindState('unknown-format')).toBe('text');
 expect(kinds.quickLookKind('💾','data.bin',false)).toBe('text');
 expect(kinds.quickLookKind('🎬','movie.mp4',false)).toBe('video');
});
