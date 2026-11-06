import { test, expect, afterAll } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, renameSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { menuaction, capturedPaths } from '../src/menu.js';
import { collisions, transfer } from '../src/transfer.js';
const dir=mkdtempSync(join(tmpdir(),'flea-menu-'));afterAll(()=>rmSync(dir,{recursive:true,force:true}));
let serial=0;
function setup() {
 const id=++serial, root=join(dir,String(id));mkdirSync(root);
 const src=join(root,'source'),dest=join(root,'dest');mkdirSync(src);mkdirSync(dest);
 const path=join(src,'hello');writeFileSync(path,'original');
 const messages=[],send=m=>messages.push(m),listing={path:src,rows:[{name:'hello'}]};
 menuaction({id,op:'snapshot',rows:[0],cursor:0},send,listing,1);
 return {id,path,src,dest,messages,send,listing};
}
async function done(s, request) {
 transfer(request,s.send,s.listing,1);
 for(let i=0;i<200;i++) {const result=s.messages.find(m=>m.t==='transferdone');if(result)return result; await Bun.sleep(5);}
 throw Error('transfer did not complete: '+JSON.stringify(s.messages));
}
test('Copy to survives menu close',async()=>{
 const s=setup();collisions({id:20,menuId:s.id,dest:s.dest},s.send,s.listing,1);
 menuaction({id:s.id,op:'close'},s.send,s.listing,1);
 const result=await done(s,{menuId:s.id,collideId:20,dest:s.dest,op:'copy',collide:'refuse'});
 expect(result.ok).toBe(1);expect(readFileSync(join(s.dest,'hello'),'utf8')).toBe('original');
});
test('reject source replaced after collision question',async()=>{
 const s=setup();collisions({id:21,menuId:s.id,dest:s.dest},s.send,s.listing,1);
 menuaction({id:s.id,op:'close'},s.send,s.listing,1);
 renameSync(s.path,s.path+'.old');writeFileSync(s.path,'replacement');
 expect((await done(s,{menuId:s.id,collideId:21,dest:s.dest,op:'copy'})).failed).toBe(1);
});
test('question cannot authorize another destination or be reused',()=>{
 const s=setup();collisions({id:22,menuId:s.id,dest:s.dest},s.send,s.listing,1);
 menuaction({id:s.id,op:'close'},s.send,s.listing,1);
 transfer({menuId:s.id,collideId:22,dest:s.src},s.send,s.listing,1);
 expect(s.messages.at(-1).t).toBe('error');
 transfer({menuId:s.id,collideId:22,dest:s.dest},s.send,s.listing,1);
 expect(s.messages.at(-1).t).toBe('error');
});
test('invalid repeated snapshot clears old identity and refuses missing rows',()=>{
 const s=setup();menuaction({id:s.id,op:'snapshot',rows:[0,99]},s.send,s.listing,1);
 expect(s.messages.at(-1).ok).toBe(false);expect(capturedPaths(s.id)).toBeNull();
});
test('cursor outside selection also retains identity',()=>{
 const s=setup(),cursor=join(s.src,'cursor');writeFileSync(cursor,'cursor');
 menuaction({id:s.id,op:'snapshot',paths:[s.path],cursorPath:cursor},s.send,s.listing,1);
 renameSync(cursor,cursor+'.old');writeFileSync(cursor,'replacement');
 menuaction({id:s.id,op:'activate',action:'sharelink'},s.send,s.listing,1);
 expect(s.messages.at(-1).ok).toBe(false);
});
test('keyboard menuId zero copies without a menu snapshot',async()=>{
 const s=setup();collisions({id:99,menuId:0,rows:[0],dest:s.dest},s.send,s.listing,1);
 const result=await done(s,{menuId:0,collideId:99,rows:[0],dest:s.dest,op:'copy',collide:'refuse'});
 expect(result.ok).toBe(1);expect(readFileSync(join(s.dest,'hello'),'utf8')).toBe('original');
});
