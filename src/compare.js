// Compare uses the same bunmsh -cc builtin launch convention as Find.
import {existsSync} from 'node:fs';
import {open} from 'node:fs/promises';
import {constants} from 'node:fs';
import {join,isAbsolute} from 'node:path';
const LIMIT=1024*1024, PATCH_LIMIT=8*LIMIT;
export function diffCommands({which=Bun.which,exists=existsSync,beside=join(import.meta.dir,'../../bunmsh/index.js')}={}) {
 const commands=[];
 if(exists(beside))commands.push([which('bun')||process.argv0,beside,'-cc','builtin','diff']);
 const shell=which('bunmsh');if(shell)commands.push([shell,'-cc','builtin','diff']);
 const diff=which('diff');if(diff)commands.push([diff]);
 return commands;
}
async function read(path) {
 if(typeof path!=='string'||!isAbsolute(path))throw Error('Not an absolute path');
 const f=await open(path,constants.O_RDONLY|(constants.O_NONBLOCK||0));
 try {
  const stat=await f.stat();if(!stat.isFile())throw Error('Not a regular file');
  if(stat.size>LIMIT)return {over:true};
  const data=Buffer.alloc(LIMIT+1);let count=0;
  while(count<data.length){const r=await f.read(data,count,data.length-count,null);if(!r.bytesRead)break;count+=r.bytesRead;}
  return {over:count>LIMIT,data:data.subarray(0,count)};
 }finally{await f.close()}
}
async function run(argv,signal,timeout) {
 let child,reader,timer,stopped=false;
 // Diff is read-only: cancellation needs no graceful shutdown. Terminate even a
 // provider that ignores SIGTERM, and release a pipe inherited by descendants.
 const stop=()=>{
  if(stopped)return;
  stopped=true;
  try{child?.kill('SIGKILL')}catch{}
  if(reader)void reader.cancel().catch(()=>{});
 };
 try {
  if(signal?.aborted)return null;
  child=Bun.spawn(argv,{stdin:'ignore',stdout:'pipe',stderr:'ignore',env:{...process.env,NO_COLOR:'1',FORCE_COLOR:'0'}});
  reader=child.stdout.getReader();
  signal?.addEventListener('abort',stop,{once:true});
  if(signal?.aborted)stop();
  timer=setTimeout(stop,timeout);
  const chunks=[];let size=0;
  while(!stopped){
   const {done,value:chunk}=await reader.read();if(done)break;
   size+=chunk.length;if(size>PATCH_LIMIT){stop();break;}chunks.push(chunk);
  }
  const code=await child.exited;if(stopped)return null;
  const patch=new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks));
  if(code===0)return {state:'identical',patch:''};
  if(code===1 && /^--- .*\n\+\+\+ .*\n@@ /s.test(patch))return {state:'diff',patch};
  return false; // An older bunmsh may not yet support -u: try the next provider.
 }catch{return stopped?null:false}
 finally{
  clearTimeout(timer);signal?.removeEventListener('abort',stop);
  if(reader){try{await reader.cancel()}catch{}reader.releaseLock();}
  if(child){try{child.kill('SIGKILL')}catch{}await child.exited.catch(()=>{});}
 }
}
export async function compare(request,{commands=diffCommands(),signal,timeout=10000}={}) {
 const reply={t:'compare',token:request.token,state:'failed',patch:''};
 try {
  const a=await read(request.a),b=await read(request.b);
  if(a.over||b.over)return {...reply,state:'over'};
  if(a.data.subarray(0,8192).includes(0)||b.data.subarray(0,8192).includes(0))return {...reply,state:'binary'};
  const decoder=new TextDecoder('utf-8',{fatal:true});decoder.decode(a.data);decoder.decode(b.data);
  for(const prefix of commands){
   if(signal?.aborted)return null;
   const result=await run([...prefix,'-u','--label',request.a,'--label',request.b,'--',request.a,request.b],signal,timeout);
   if(result)return {...reply,...result};
   if(result===null)break;
  }
 }catch{}
 return signal?.aborted?null:reply;
}
