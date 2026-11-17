import {test, expect} from 'bun:test';
import {mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {defaults} from '../src/uistate.js';
const entry = fileURLToPath(new URL('../index.js',import.meta.url));

test('dump-config keeps ANSI colours through a pipe, raw is complete JSON, neither writes state', async()=>{
 const dir=mkdtempSync(join(tmpdir(),'flea-dump-'));
 const state=join(dir,'flea','ui.json');
 const env={...process.env,XDG_STATE_HOME:dir,XDG_CONFIG_HOME:dir,NO_COLOR:'1',TERM:'dumb',FORCE_COLOR:'0'};
 try {
  mkdirSync(join(dir,'flea'));
  const original='{"places":{"sidebarWidth":224},"hidden":true}\n';
  writeFileSync(state,original);
  for(const flag of ['--dump-config','--dump-config-raw']) {
   const source=Bun.spawn([process.execPath,entry,flag],{env,stdin:'ignore',stdout:'pipe',stderr:'pipe'});
   // Real process-to-process pipe: no TTY at either end.
   const sink=Bun.spawn([process.execPath,'-e','process.stdout.write(await Bun.stdin.text())'],{
    env,stdin:source.stdout,stdout:'pipe',stderr:'pipe'
   });
   const output=await new Response(sink.stdout).text();
   expect(await source.exited).toBe(0);
   expect(await sink.exited).toBe(0);
   expect(await new Response(source.stderr).text()).toBe('');
   if(flag==='--dump-config'){
    expect(output).toMatch(/\x1b\[[\d;]*m/);
    expect(Bun.stripANSI(output)).toContain('sidebarWidth: 224');
    expect(Bun.stripANSI(output)).toContain('hidden: true');
   }else{
    expect(output).not.toContain('\x1b');
    expect(JSON.parse(output)).toEqual({...defaults(),places:{...defaults().places,sidebarWidth:224},hidden:true});
   }
   expect(readFileSync(state,'utf8')).toBe(original);
  }
  const clean=join(dir,'new');
  const child=Bun.spawn([process.execPath,entry,'--dump-config-raw'],{
   env:{...env,XDG_STATE_HOME:clean},stdout:'pipe',stderr:'pipe'
  });
  expect(JSON.parse(await new Response(child.stdout).text())).toEqual(defaults());
  expect(await child.exited).toBe(0);
  expect(existsSync(clean)).toBe(false);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
