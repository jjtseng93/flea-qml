import {test,expect} from 'bun:test';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';import {tmpdir} from 'node:os';
import {compare,diffCommands} from '../src/compare.js';
test('diff searches sibling bunmsh, PATH bunmsh, then system using -cc builtin',()=>{
 expect(diffCommands({which:n=>'/bin/'+n,exists:()=>true,beside:'/src/bunmsh/index.js'})).toEqual([
 ['/bin/bun','/src/bunmsh/index.js','-cc','builtin','diff'],['/bin/bunmsh','-cc','builtin','diff'],['/bin/diff']]);
 expect(diffCommands({which:n=>n==='diff'?'/bin/diff':null,exists:()=>false})).toEqual([['/bin/diff']]);
});
test('Compare emits unified patches and all terminal states, falls back and cancels',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'flea-compare-'));const a=join(dir,"a 中文 ' $.txt"),b=join(dir,'b.txt');
 const ask={a,b,token:42};
 try {
  writeFileSync(a,'first\nold\n');writeFileSync(b,'first\nnew\n');
  const r=await compare(ask);expect(r.state).toBe('diff');expect(r.patch).toContain('-old\n+new\n');expect(r.token).toBe(42);
  expect((await compare({...ask,b:a})).state).toBe('identical');
  expect((await compare({...ask,b:dir})).state).toBe('failed');
  expect((await compare({...ask,b:b+'missing'})).state).toBe('failed');
  writeFileSync(b,'x\0y');expect((await compare(ask)).state).toBe('binary');
  writeFileSync(b,'x'.repeat(1048577));expect((await compare(ask)).state).toBe('over');
  writeFileSync(b,'other\n');
  expect((await compare(ask,{commands:[[process.execPath,'-e','process.exit(2)'],...diffCommands()]})).state).toBe('diff');
  expect((await compare(ask,{commands:[[process.execPath,'-e','setInterval(()=>{},1000)']],timeout:100})).state).toBe('failed');
  const control=new AbortController();control.abort();expect(await compare(ask,{signal:control.signal})).toBe(null);
 }finally{rmSync(dir,{recursive:true,force:true})}
},15000);

test('timeout and in-flight abort kill a provider that ignores SIGTERM',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'flea-compare-cancel-'));
 const a=join(dir,'a'),b=join(dir,'b'),ready=join(dir,'ready');
 writeFileSync(a,'a');writeFileSync(b,'b');
 const provider=join(dir,'provider.js');
 // Self-exit bounds a regression without leaving a test process alive.
 writeFileSync(provider,`process.on('SIGTERM',()=>{});await Bun.write(${JSON.stringify(ready)},String(process.pid));setTimeout(()=>process.exit(0),6000);`);
 try{
  for(const abort of [false,true]){
   rmSync(ready,{force:true});
   const control=new AbortController();
   const start=performance.now();
   const pending=compare({a,b},{commands:[[process.execPath,provider]],signal:control.signal,timeout:abort?10000:1000});
   let pid;
   for(let i=0;i<100;i++){
    if(await Bun.file(ready).exists()){pid=Number(await Bun.file(ready).text());break}
    await Bun.sleep(20);
   }
   expect(pid).toBeGreaterThan(0);
   if(abort)control.abort();
   const result=await pending;
   expect(performance.now()-start).toBeLessThan(3000);
   if(abort)expect(result).toBe(null);else expect(result.state).toBe('failed');
   expect(()=>process.kill(pid,0)).toThrow();
  }
 }finally{rmSync(dir,{recursive:true,force:true})}
},15000);
