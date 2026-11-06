import { test, expect } from 'bun:test';
const source=(await Bun.file(new URL('../ui/js/Input.js',import.meta.url)).text()).replace(/^\.pragma library\s*/,'');
const warnings=[];
const {pasteInto}=new Function('console',source+'; return {pasteInto};')({warn: e=>warnings.push(e)});
test('paste synchronous and asynchronous clipboard text',async()=>{
 const values=[];pasteInto({clipboardText:()=> 'hello\nother'},v=>values.push(v));
 pasteInto({clipboardText:()=>Promise.resolve('中文😀')},v=>values.push(v));
 await Bun.sleep(0);expect(values).toEqual(['hello','中文😀']);
});
test('clipboard exceptions and rejections are caught',async()=>{
 warnings.length=0;
 pasteInto({clipboardText:()=>{throw Error('sync')}},()=>{});
 pasteInto({clipboardText:()=>Promise.reject(Error('async'))},()=>{});
 await Bun.sleep(0);expect(warnings.length).toBe(2);
});
