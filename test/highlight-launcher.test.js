import {test,expect,afterAll} from 'bun:test';
import {mkdtempSync,mkdirSync,copyFileSync,writeFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
const root=mkdtempSync(join(tmpdir(),'flea-highlight-'));
afterAll(()=>rmSync(root,{recursive:true,force:true}));
let serial=0;
async function run(name,{failure=false,sibling=false,filetype=null}={}) {
 const dir=join(root,String(++serial)),src=join(dir,'flea','src'),bin=join(dir,'commands');
 mkdirSync(src,{recursive:true});mkdirSync(bin);
 // Isolate discovery from the real sibling checkout without changing it or using links.
 copyFileSync(new URL('../src/highlight.js',import.meta.url),join(src,'highlight.js'));
 const path=join(dir,'sample with spaces.js');writeFileSync(path,'const n = 1;');
 const args=['--cat','--edit',...(filetype?['-filetype',filetype]:[]),path];
 const body=`if (JSON.stringify(process.argv.slice(2)) !== JSON.stringify(${JSON.stringify(args)})) process.exit(9);\nprocess.stdout.write('\\x1b[31mconst\\x1b[0m n = 1;\\n');\n`;
 writeFileSync(join(bin,name),`#!${process.execPath}\n${failure?'process.exit(7);':body}`,{mode:0o755});
 if(sibling){const target=join(dir,'jsmdcui','src');mkdirSync(target,{recursive:true});writeFileSync(join(target,'index.js'),body);}
 const script=join(src,'probe.js');
 writeFileSync(script,`import {highlightFile,jsmdcui} from './highlight.js'; console.log(JSON.stringify({command:jsmdcui(),lines:await highlightFile(${JSON.stringify(path)},undefined,${JSON.stringify(filetype)})}));`);
 const proc=Bun.spawn([process.execPath,script],{env:{...process.env,PATH:bin},stdout:'pipe',stderr:'pipe'});
 const [text,err,code]=await Promise.all([new Response(proc.stdout).text(),new Response(proc.stderr).text(),proc.exited]);
 expect({code,err}).toEqual({code:0,err:''});
 return {result:JSON.parse(text),bin};
}
for(const name of ['jmi','jsmdcui'])test(`executes PATH ${name} launcher without guessing its install layout`,async()=>{
 const {result,bin}=await run(name);expect(result.command).toEqual([join(bin,name)]);expect(result.lines[0]).toEqual([1,'const',0,' n = 1;']);
});
test('failed launcher preserves plain-text fallback',async()=>{expect((await run('jmi',{failure:true})).result.lines).toBeNull();});
test('sibling checkout still runs through Bun before PATH launchers',async()=>{
 const {result}=await run('jmi',{failure:true,sibling:true});expect(result.command.length).toBe(2);expect(result.command[1]).toEndWith('/jsmdcui/src/index.js');expect(result.lines[0][0]).toBe(1);
});

test('passes a language override as the single-dash jsmdcui setting',async()=>{
 expect((await run('jmi',{filetype:'v'})).result.lines[0][0]).toBe(1);
});
