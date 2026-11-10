// bun test/manual-code-scroll.mjs (requires sibling buninu-browser).
import {rm} from 'node:fs/promises';
import {createBrowser} from '../../buninu-browser/lib/headless-shell.js';
const repo=Bun.fileURLToPath(new URL('../',import.meta.url));
const qml=repo+'ui/boot/.scroll-check-'+process.pid+'.qml';
const text='x'.repeat(512)+'/system/bin/linker64\n'+Array.from({length:150},(_,i)=>'line '+i).join('\n');
await Bun.write(qml,`import QtQuick\nimport Quickshell\nimport ".." as Flea\nFloatingWindow {width:500;height:300;color:"#171b22";Flea.CodeLines {id:code;anchors.fill:parent;fromText:true;text:${JSON.stringify(text)};active:true;scrolls:true;Component.onCompleted:globalThis.code=code;Flea.FastScrollHandler {flickable:code.viewport}}}`);
const browser=await createBrowser({spareRenderer:false});
try{
 await browser.context.navigate(Bun.pathToFileURL(qml).href);
 await Bun.sleep(300);
 const run=s=>browser.context.evaluate(s);
 const before=await run('({w:code.viewport.width,cw:code.viewport.contentWidth,h:code.viewport.height,ch:code.viewport.contentHeight})');
 if(before.cw<=before.w||before.ch<=before.h)throw Error(JSON.stringify(before));
 await run('document.elementFromPoint(200,100).dispatchEvent(new WheelEvent("wheel",{bubbles:true,cancelable:true,clientX:200,clientY:100,deltaX:200,deltaY:0}))');
 await Bun.sleep(100);
 if(!(await run('code.viewport.contentX > 0')))throw Error('Horizontal wheel failed');
 await run('document.elementFromPoint(200,100).dispatchEvent(new WheelEvent("wheel",{bubbles:true,cancelable:true,clientX:200,clientY:100,deltaX:0,deltaY:150}))');
 await Bun.sleep(100);
 if(!(await run('code.viewport.contentY > 0')))throw Error('Vertical wheel failed');
 await run('code.viewport.contentY=0;code.viewport.contentX=code.viewport.contentWidth-code.viewport.width');
 await Bun.write('/tmp/flea-code-scroll.png',Buffer.from(await browser.context.screenshot({format:'png'}),'base64'));
 await run('code.wrap=true');await Bun.sleep(100);
 if(!await run('code.viewport.contentX===0 && code.viewport.contentWidth===code.viewport.width'))throw Error('Wrap did not reset horizontal lane');
 await run('code.wrap=false;code.text="short"');await Bun.sleep(100);
 if(!await run('code.viewport.contentX===0 && code.viewport.contentWidth===code.viewport.width'))throw Error('New file did not reset width');
 console.log('PASS horizontal/vertical wheel, wrap and new file reset',before);
}finally{await browser.close();await rm(qml,{force:true})}
