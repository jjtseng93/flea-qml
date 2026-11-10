// Run: bun test/manual-syntax-preview.mjs [path/to/jsmdcui]
// Uses that checkout's runtime/syntax definitions and syntax-parity samples.
import {resolve,join} from 'node:path';
const base=resolve(process.argv[2] || new URL('../../jsmdcui',import.meta.url).pathname);
const {SyntaxDefinition,parseHeaderYaml,detectSyntax}=await import(Bun.pathToFileURL(join(base,'src/highlight/parser.js')).href);
import {code} from '../src/code.js';
import {runsOf} from '../src/highlight.js';
import {tmpdir} from 'node:os';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
const defs=[];
for(const file of new Bun.Glob('*.yaml').scanSync(base+'/runtime/syntax')) {const text=await Bun.file(base+'/runtime/syntax/'+file).text(),src=Bun.YAML.parse(text);defs.push({file,def:new SyntaxDefinition(parseHeaderYaml(src),src,text)});}
const dir=mkdtempSync(join(tmpdir(),'flea-syntax-'));const results=[];
const words=new Set(['Dockerfile','Containerfile','.bashrc','Makefile','CMakeLists.txt','README.md','Cargo.lock','sample.dats','sample.f90','sample.ebuild','sample.eclass','gitconfig','git-rebase-todo','go.mod','meson.build','sample.mm','sample.pl','sample.ps1','Xresources','sample.yml','sample.zig','sample.zc']);
for(const {def} of defs) for(const w of (def.header.filename||'').match(/[A-Za-z0-9_-]+/g)||[]) {words.add(w);words.add('.'+w);words.add('sample.'+w);words.add(w+'.conf');}
let index=0;
try {await Promise.all(Array.from({length:4},async()=>{for(;;){const i=index++;if(i>=defs.length)return;const {file,def}=defs[i];if(/^html[45]?$/.test(def.filetype))continue;
 const sample=Bun.file(base+'/tests/syntax-parity/samples/'+file.replace(/yaml$/,'txt'));if(!await sample.exists()){results.push({file,error:'missing sample'});continue;}
 const text=await sample.text();
 const child=Bun.spawn([process.execPath,join(base,'src/index.js'),'--cat','--edit','-filetype',def.filetype,sample.name],{stdout:'pipe',stderr:'pipe'});
 const [ansi,stderr,exit]=await Promise.all([new Response(child.stdout).text(),new Response(child.stderr).text(),child.exited]);
 const explicitColour=exit===0 && ansi.split('\n').some(l=>runsOf(l).some((v,i)=>i%2===0&&v!==0));
 const path=[...words].find(p=>def.header.matchFileName(p)&&detectSyntax(defs.map(x=>x.def),{path:p,firstLine:text.split('\n')[0],lines:text.split('\n').slice(0,50)})?.filetype===def.filetype);
 if(!path){results.push({file,explicitColour,error:'no automatic filename witness',pattern:def.header.filename});continue;}
 const target=dir+'/'+i;await Bun.write(target+'/'+path,text);const r=await code({path:target+'/'+path});results.push({file,explicitColour,path,state:r.state,lines:r.total});
}}));}finally{rmSync(dir,{recursive:true,force:true});}
results.sort((a,b)=>a.file.localeCompare(b.file));await Bun.write(join(tmpdir(),'flea-syntax-results.json'),JSON.stringify(results,null,2));console.log(JSON.stringify({total:results.length,explicitColour:results.filter(r=>r.explicitColour).length,styled:results.filter(r=>r.state==='styled').length,other:results.filter(r=>r.state!=='styled')},null,2));
