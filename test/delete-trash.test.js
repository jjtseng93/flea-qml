import {test,expect,afterAll} from 'bun:test';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,renameSync,symlinkSync,lstatSync,rmSync,readdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {menuaction} from '../src/menu.js';
import {trashOne,trash} from '../src/trash.js';
const root=mkdtempSync(join(tmpdir(),'flea-mutations-'));
const original=process.env.XDG_DATA_HOME;
process.env.XDG_DATA_HOME=join(root,'data');
afterAll(()=>{if(original===undefined)delete process.env.XDG_DATA_HOME;else process.env.XDG_DATA_HOME=original;rmSync(root,{recursive:true,force:true});});
let next=1000;
function fixture() {
 const id=++next,path=join(root,String(id));mkdirSync(path);writeFileSync(join(path,'file'),'hello');
 const messages=[],send=m=>messages.push(m);
 const call=(op,rest={})=>{menuaction({op,id,...rest},send,null,0);return messages.at(-1)};
 call('snapshot',{paths:[path]});return {path,call};
}
test('permanent delete requires a prepared token and deletes reviewed tree once',()=>{
 const {path,call}=fixture();expect(call('checkDelete').valid).toBe(false);expect(call('delete').ok).toBe(false);
 const {token}=call('prepareDelete');expect(call('checkDelete',{token}).valid).toBe(true);
 call('delete',{token});expect(existsSync(path)).toBe(false);expect(call('delete',{token}).ok).toBe(false);
});
test('new descendants invalidate confirmation before any removal',()=>{
 const {path,call}=fixture(),{token}=call('prepareDelete');writeFileSync(join(path,'new'),'new');
 expect(call('checkDelete',{token}).valid).toBe(false);expect(call('delete',{token}).stale).toBe(true);expect(existsSync(join(path,'file'))).toBe(true);
});
test('refresh captures replacement identity and updates the cursor',()=>{
 const {path,call}=fixture(),old=call('prepareDelete').token;
 renameSync(path,path+'.old');mkdirSync(path);writeFileSync(join(path,'new'),'new');
 const {token}=call('refreshDelete');expect(token).not.toBe(old);expect(call('checkDelete',{token}).valid).toBe(true);
 call('delete',{token});expect(existsSync(path)).toBe(false);expect(existsSync(path+'.old/file')).toBe(true);
});
test('review and deletion do not follow symbolic links',()=>{
 const {path,call}=fixture(),outside=join(root,'outside');mkdirSync(outside);writeFileSync(join(outside,'keep'),'keep');symlinkSync(outside,join(path,'link'));
 const {token}=call('prepareDelete');call('delete',{token});expect(readFileSync(join(outside,'keep'),'utf8')).toBe('keep');
});
test('root deletion is refused without traversing it',()=>{
 const id=++next, messages=[],send=m=>messages.push(m);
 menuaction({op:'snapshot',id,paths:['/']},send,null,0);menuaction({op:'prepareDelete',id},send,null,0);
 expect(messages.at(-1).ok).toBe(false);
});
test('trash moves files, preserves content and encodes metadata',()=>{
 const path=join(root,'space 中文.txt');writeFileSync(path,'payload');trashOne(path);
 const dir=join(process.env.XDG_DATA_HOME,'Trash');expect(existsSync(path)).toBe(false);
 expect(readFileSync(join(dir,'files','space 中文.txt'),'utf8')).toBe('payload');
 const info=readFileSync(join(dir,'info','space 中文.txt.trashinfo'),'utf8');expect(info).toContain('%20');expect(info).toContain('%E4%B8%AD');expect(info).toContain('DeletionDate=');
});
test('trash does not overwrite an orphan or a prior trashed name',()=>{
 const path=join(root,'same');writeFileSync(path,'first');trashOne(path);writeFileSync(path,'second');trashOne(path);
 const files=join(process.env.XDG_DATA_HOME,'Trash/files');writeFileSync(join(files,'orphan'),'old');
 const other=join(root,'orphan');writeFileSync(other,'new');trashOne(other);
 expect(readFileSync(join(files,'same'),'utf8')).toBe('first');expect(readFileSync(join(files,'same.2'),'utf8')).toBe('second');
 expect(readFileSync(join(files,'orphan'),'utf8')).toBe('old');expect(readFileSync(join(files,'orphan.2'),'utf8')).toBe('new');
});
test('trash keeps symlink as a symlink and reports per-item failures',()=>{
 const path=join(root,'link');symlinkSync(join(root,'missing-target'),path);
 const events=[];trash({id:1},m=>events.push(m),{paths:[path,join(root,'absent')]});
 expect(lstatSync(join(process.env.XDG_DATA_HOME,'Trash/files/link')).isSymbolicLink()).toBe(true);
 const result=events.find(m=>m.t==='trashed');expect(result.ok).toBe(1);expect(result.failed).toBe(1);
});
test('unsafe symlink Trash is refused without moving the source',()=>{
 const saved=process.env.XDG_DATA_HOME,dir=join(root,'unsafe'),outside=join(root,'unrelated');mkdirSync(dir);mkdirSync(outside);
 symlinkSync(outside,join(dir,'Trash'));process.env.XDG_DATA_HOME=dir;
 const path=join(root,'keep');writeFileSync(path,'keep');
 try {expect(()=>trashOne(path)).toThrow();expect(existsSync(path)).toBe(true);expect(readdirSync(outside)).toEqual([]);}
 finally{process.env.XDG_DATA_HOME=saved;}
});
