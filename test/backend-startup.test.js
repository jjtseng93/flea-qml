import {test,expect} from 'bun:test';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';

test('backend accepts immediate listing and first-use Markdown requests without losing the latest token',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'flea-backend-start-'));
 writeFileSync(join(dir,'probe.txt'),'');
 const child=Bun.spawn([process.execPath,fileURLToPath(new URL('../src/flea.js',import.meta.url)),'--backend'],{
  env:{...process.env,XDG_STATE_HOME:dir,XDG_CACHE_HOME:dir,XDG_CONFIG_HOME:dir,XDG_DATA_HOME:dir},stdin:'pipe',stdout:'pipe',stderr:'pipe'});
 const errors=new Response(child.stderr).text();
 const timer=setTimeout(()=>child.kill(),5000);
 const replies=[];
 try{
  child.stdin.write([
   {c:'list',path:dir},
   {c:'markdownhtml',path:join(dir,'preview.md'),slot:'preview',token:1,source:'# Old'},
   {c:'markdownhtml',path:join(dir,'preview.md'),slot:'preview',token:2,source:'# Latest\n\n$x^2$'},
  ].map(x=>JSON.stringify(x)).join('\n')+'\n');child.stdin.flush();
  const decoder=new TextDecoder();let tail='';
  for await(const bytes of child.stdout){
   tail+=decoder.decode(bytes,{stream:true});let end;
   while((end=tail.indexOf('\n'))>=0){const line=tail.slice(0,end);tail=tail.slice(end+1);if(line)replies.push(JSON.parse(line));}
   if(replies.some(x=>x.t==='listed')&&replies.some(x=>x.t==='markdownhtml'&&x.token===2))break;
  }
  expect(replies.some(x=>x.t==='listed')).toBe(true);
  const previews=replies.filter(x=>x.t==='markdownhtml');
  expect(previews.map(x=>x.token)).toEqual([2]);
  expect(previews[0].state).toBe('ready');
  expect(previews[0].html).toContain('Latest');
  expect(previews[0].html).toContain('<math');
 }finally{
  clearTimeout(timer);child.kill();await child.exited;await errors;
  rmSync(dir,{recursive:true,force:true});
 }
},10000);
