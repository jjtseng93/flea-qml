import { test, expect } from 'bun:test';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HostClipboard, clipHostReply } from '../src/clip-host.js';
import { clipText, parseClipText } from '../src/clip.js';

const source = (await Bun.file(new URL('../ui/js/HostClipboard.js', import.meta.url)).text()).replace(/^\.pragma.*$/gm, '');
const makeHandler = () => new Function(source + ';return handle')();
const none = { clip: 'none', paths: [], token: '', skipped: 0 };
function fixture() {
  let text = '', reads = 0, failRead = false, failWrite = false;
  const writes = [], handle = makeHandler();
  const qs = {
    async readClipboardText(options) { expect(options.strict).toBe(true); reads++; if(failRead)throw Error('read denied'); return text; },
    async writeClipboardText(value) { if(failWrite)throw Error('write denied'); writes.push(value);text=value; },
  };
  const send = message => handle({send: clipHostReply}, qs, message);
  const dc = new HostClipboard(send, { clipText, parseClipText, none });
  return { dc, writes, get text(){return text}, set text(v){text=v}, get reads(){return reads},
    failRead(v){failRead=v},failWrite(v){failWrite=v},
    second:()=>new HostClipboard(send,{clipText,parseClipText,none}) };
}
function files() {
  const dir = mkdtempSync(join(tmpdir(), 'flea-clip-'));
  const paths = [join(dir, "a 'quoted' 中文\nline"),join(dir,'back\\slash $` name')];
  for(const path of paths)writeFileSync(path,'test');
  return {paths,cleanup:()=>rmSync(dir,{recursive:true,force:true})};
}

test('QS fallback preserves POSIX copy/cut bytes and fresh cross-window paste', async()=>{
  const f=files(),h=fixture();
  try {
    await h.dc.set(null,{op:'copy',paths:f.paths,token:'a'});
    expect(h.text).toBe(clipText('copy',f.paths));expect(h.reads).toBe(0);
    expect((await h.dc.snapshot()).paths).toEqual(f.paths);
    await h.dc.set(null,{op:'cut',paths:f.paths,token:'b'});
    expect(h.text).toBe('""'+clipText('copy',f.paths)+'""');
    expect(await h.second().snapshot()).toEqual({clip:'cut',paths:f.paths,token:'',skipped:0});
    h.text='a newer Android clipboard';
    expect(await h.dc.snapshot()).toEqual(none);
    expect(await h.dc.clearIf({token:'b'})).toBe(false);
    expect(h.text).toBe('a newer Android clipboard');
  } finally {f.cleanup()}
});
test('spent cut clears only identical text, even after its files moved',async()=>{
  const f=files(),h=fixture();
  await h.dc.set(null,{op:'cut',paths:f.paths,token:'old'});
  f.cleanup();
  expect(await h.dc.clearIf({token:'wrong'})).toBe(false);
  expect(await h.dc.clearIf({token:'old'})).toBe(true);expect(h.text).toBe('');
  h.text=clipText('cut',f.paths);
  expect(await h.second().clearIf({cut:f.paths})).toBe(true);
  h.text=clipText('copy',f.paths);
  expect(await h.dc.clearIf({cut:f.paths})).toBe(false);
});
test('read/write failure is not a cached success and later operations recover',async()=>{
  const h=fixture();h.failWrite(true);
  await expect(h.dc.set(null,{op:'text',paths:['bad'],token:''})).rejects.toThrow('write denied');
  expect(h.dc.owned).toBe(null);h.failWrite(false);
  await h.dc.set(null,{op:'text',paths:['good'],token:''});expect(h.text).toBe('good');
  h.failRead(true);await expect(h.dc.snapshot()).rejects.toThrow('read denied');
  h.failRead(false);expect(await h.dc.snapshot()).toEqual(none);
});
test('overlapping operations are ordered; native QS property fallback uses identical text',async()=>{
  const h=fixture();
  await Promise.all(['one','two','three'].map(x=>h.dc.set(null,{op:'text',paths:[x],token:''})));
  expect(h.writes).toEqual(['one','two','three']);
  const handle=makeHandler(),qs={clipboardText:''},replies=[];
  const text='""\'C:/has space/a\'\'\\\'\'b\'""';
  await handle({send:m=>replies.push(m)},qs,{id:1,op:'write',text});
  await handle({send:m=>replies.push(m)},qs,{id:2,op:'read'});
  expect(qs.clipboardText).toBe(text);expect(replies[1].text).toBe(text);
});

test('real backend negotiates missing-Wayland fallback and exchanges QS clipboard replies',async()=>{
  const f=files(),dir=mkdtempSync(join(tmpdir(),'flea-no-wayland-'));
  const child=Bun.spawn([process.execPath,new URL('../src/flea.js',import.meta.url).pathname,'--backend'],{
    env:{...process.env,WAYLAND_DISPLAY:join(dir,'missing'),XDG_RUNTIME_DIR:dir},stdin:'pipe',stdout:'pipe',stderr:'pipe'});
  const errors=new Response(child.stderr).text(),lines=[],waiters=[];
  let text='';const qs={readClipboardText:async()=>text,writeClipboardText:async t=>{text=t}};
  const send=m=>{child.stdin.write(JSON.stringify(m)+'\n');child.stdin.flush()},handle=makeHandler();
  const reading=(async()=>{
    let tail='';const decoder=new TextDecoder();
    for await(const chunk of child.stdout){tail+=decoder.decode(chunk,{stream:true});let index;
      while((index=tail.indexOf('\n'))>=0){const line=tail.slice(0,index);tail=tail.slice(index+1);if(!line)continue;
        const m=JSON.parse(line);
        if(m.t==='clipHost'){void handle({send},qs,m);continue;}
        lines.push(m);for(const notify of [...waiters])notify();
      }
    }
  })();
  async function next(op,action){
    const start=lines.length;
    const promise=new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{waiters.splice(waiters.indexOf(check),1);reject(Error('reply timeout '+op))},5000);
      const check=()=>{const found=lines.slice(start).find(m=>m.t==='clip'&&m.op===op);if(found){clearTimeout(timer);waiters.splice(waiters.indexOf(check),1);resolve(found)}};
      waiters.push(check);
    });action();return promise;
  }
  try {
    const watch=await next('changed',()=>send({c:'clipWatch',hostText:true}));expect(watch.error).toContain('read on demand');
    const set=await next('set',()=>send({c:'clipSet',op:'cut',paths:f.paths}));expect(set.ok).toBe(true);
    expect(text).toBe(clipText('cut',f.paths));
    const get=await next('get',()=>send({c:'clipGet'}));expect(get.paths).toEqual(f.paths);expect(get.clip).toBe('cut');
    expect(get.token).toBe(set.token);
    text='new Android text';
    const clear=await next('clear',()=>send({c:'clipClear',token:set.token}));expect(clear.cleared).toBe(false);
    const fresh=await next('get',()=>send({c:'clipGet'}));expect(fresh.clip).toBe('none');
    send({c:'quit'});expect(await child.exited).toBe(0);await reading;
    expect(await errors).toBe('');
  } finally {child.kill();await child.exited;f.cleanup();rmSync(dir,{recursive:true,force:true})}
},15000);
