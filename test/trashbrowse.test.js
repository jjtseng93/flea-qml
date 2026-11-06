import {test, expect, beforeEach, afterEach} from 'bun:test';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,renameSync,symlinkSync,existsSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {trashOne,homeTrash,trashInfoPath,trashInfoOriginal} from '../src/trash.js';
import {trashbrowse,readTrash,watchTrashCount} from '../src/trashbrowse.js';
let root,saved,stop;
const call=(op,fields={})=>{const replies=[];trashbrowse({op,id:1,...fields},m=>replies.push(m));return replies.find(m=>m.t==='trashbrowse');};
beforeEach(()=>{root=mkdtempSync(join(tmpdir(),'flea-trashbrowse-'));saved=process.env.XDG_DATA_HOME;process.env.XDG_DATA_HOME=join(root,'data');mkdirSync(process.env.XDG_DATA_HOME);call('cancel',{clearSelection:true});});
afterEach(()=>{stop?.();stop=null;if(saved===undefined)delete process.env.XDG_DATA_HOME;else process.env.XDG_DATA_HOME=saved;rmSync(root,{recursive:true,force:true});});
function item(name='sample',directory=false){const path=join(root,name);if(directory){mkdirSync(path);writeFileSync(join(path,'keep'),'keep');}else writeFileSync(path,'payload');trashOne(path);return readTrash().find(i=>i.original===path);}
test('Trash list, restore, collisions and single-use deletion',()=>{
 const a=item('a');expect(call('list',{count:20}).rows.some(r=>r.uri===a.uri)).toBe(true);
 writeFileSync(a.original,'new');expect(call('restore',{uris:[a.uri],identities:[a.identity]}).failed).toBe(1);
 expect(readFileSync(a.original,'utf8')).toBe('new');rmSync(a.original);
 expect(call('restore',{uris:[a.uri],identities:[a.identity]}).done).toBe(1);expect(readFileSync(a.original,'utf8')).toBe('payload');
 const b=item('b');const {token}=call('prepare',{uris:[b.uri],identities:[b.identity]});
 expect(call('check',{token}).valid).toBe(true);expect(call('delete',{token}).done).toBe(1);expect(call('delete',{token}).ok).toBe(false);
});
test('cancel and failed replacement reviews invalidate deletion tokens',()=>{
 const a=item();let {token}=call('prepare',{uris:[a.uri]});call('cancel');expect(call('delete',{token}).ok).toBe(false);
 ({token}=call('prepare',{uris:[a.uri]}));expect(call('prepare',{uris:['missing']}).ok).toBe(false);
 expect(call('delete',{token}).ok).toBe(false);expect(existsSync(a.file)).toBe(true);
});
test('new descendants invalidate the whole deletion review',()=>{
 const a=item('folder',true),{token}=call('prepare',{uris:[a.uri]});
 writeFileSync(join(a.file,'new'),'new');expect(call('check',{token}).valid).toBe(false);
 expect(call('delete',{token}).stale).toBe(true);expect(existsSync(join(a.file,'keep'))).toBe(true);
});
test('bulk selection refuses replaced files and metadata',()=>{
 const a=item();call('list',{count:20});const {selectionToken}=call('select');
 renameSync(a.file,a.file+'.old');writeFileSync(a.file,'replacement');
 expect(call('restore',{selectionToken}).stale).toBe(true);
 call('list',{count:20});const selected=call('select');writeFileSync(a.info,'[Trash Info]\nPath=/another-place\n');
 expect(call('prepare',{selectionToken:selected.selectionToken}).stale).toBe(true);
});
test('Trash ignores symlink directories and dot metadata names',()=>{
 const a=item();writeFileSync(join(homeTrash(),'info','...trashinfo'),'[Trash Info]\nPath=/bad\n');
 expect(readTrash().some(i=>i.name==='..')).toBe(false);
 const files=join(homeTrash(),'files');renameSync(files,files+'.old');symlinkSync(files+'.old',files);
 expect(readTrash().some(i=>i.uri===a.uri)).toBe(false);
});
test('metadata round trips punctuation and rejects escaping relative paths',()=>{
 const path=join(root,'a:b #中文 % x');expect(trashInfoOriginal(trashInfoPath(path), '')).toBe(path);
 expect(trashInfoOriginal(trashInfoPath(path,root),root)).toBe(path);
 for(const bad of ['../outside','%2e%2e/outside','%2foutside','bad%00name','%ZZ',''])expect(trashInfoOriginal(bad,root)).toBe('');
});
test('count watcher reports same-count replacements and disposes',async()=>{
 const a=item();let reports=0;stop=watchTrashCount(()=>reports++);expect(reports).toBe(1);
 renameSync(a.file,a.file+'.old');writeFileSync(a.file,'replacement');
 const deadline=Date.now()+3000;while(reports<2 && Date.now()<deadline)await Bun.sleep(20);
 expect(reports).toBeGreaterThan(1);stop();stop=null;
});
test('backend routes Trash requests and exits cleanly',()=>{
 const result=Bun.spawnSync([process.execPath,new URL('../src/flea.js',import.meta.url).pathname,'--backend'],{
  env:{...process.env},stdin:Buffer.from('{"c":"trashbrowse","op":"list","id":27,"count":10}\n{"c":"quit"}\n'),stdout:'pipe',stderr:'pipe'});
 expect(result.exitCode).toBe(0);
 const messages=result.stdout.toString().trim().split('\n').map(line=>JSON.parse(line));
 expect(messages.some(m=>m.t==='trashcount' && typeof m.revision==='number')).toBe(true);
 expect(messages.some(m=>m.t==='trashbrowse' && m.id===27 && m.ok===true)).toBe(true);
});
