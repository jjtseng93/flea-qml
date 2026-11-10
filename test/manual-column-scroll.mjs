// bun test/manual-column-scroll.mjs: complete Flea preview column, not bare CodeLines.
import {mkdtempSync,mkdirSync,rmSync} from 'node:fs';
import {join} from 'node:path';import {tmpdir} from 'node:os';
const repo=Bun.fileURLToPath(new URL('../',import.meta.url));const dir=mkdtempSync(join(tmpdir(),'flea-column-scroll-'));
for(const [key,sub] of [['HOME','home'],['XDG_DATA_HOME','data'],['XDG_CONFIG_HOME','config'],['XDG_CACHE_HOME','cache']]){process.env[key]=join(dir,sub);mkdirSync(process.env[key])}
process.env.FLEA_PATH=dir;process.env.BUNINU_BUN=process.execPath;
await Bun.write(join(dir,'long.txt'),'x'.repeat(512)+'/system/bin/linker64\n'+Array.from({length:200},(_,i)=>'line '+i).join('\n'));
const {createBrowser}=await import('../../buninu-browser/lib/headless-shell.js');
const qml=join(repo,'ui/boot/.column-scroll-'+process.pid+'.qml');
await Bun.write(qml,`import QtQuick\nimport Quickshell\nimport ".." as Flea\nFloatingWindow {id:win;width:900;height:600;Loader{anchors.fill:parent;Component.onCompleted:setSource("${Bun.pathToFileURL(join(repo,'ui/WindowBody.qml')).href}");onLoaded:{item.host=win;globalThis.body=item}}}`);
const browser=await createBrowser({spareRenderer:false});const run=s=>browser.context.evaluate(s);
const wait=async s=>{for(let i=0;i<150;i++){if(await run(s))return;await Bun.sleep(100)}throw Error('Timeout '+s)};
try{
 await browser.context.navigate(Bun.pathToFileURL(qml).href);
 await wait('!!globalThis.body && !body.currentPane.listInFlight');
 await run('body.currentPane.viewMode="columns"');await Bun.sleep(500);await run('body.currentPane.setCursor(body.currentPane.rows.findIndex(r=>r.n==="long.txt"))');
 await wait('!!body.currentPane.columnsArea?.previewColumn?.linesItem?.code?.firstScreen');
 await run('globalThis.col=body.currentPane.columnsArea.previewColumn;globalThis.v=col.linesItem.viewport');
 const rect=await run('(()=>{const r=__qmlRuntime.element(col.frameItem).getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()');
 const wheel=async(dx,dy)=>{await run(`document.elementFromPoint(${rect.x},${rect.y}).dispatchEvent(new WheelEvent("wheel",{bubbles:true,cancelable:true,clientX:${rect.x},clientY:${rect.y},deltaX:${dx},deltaY:${dy}}))`);await Bun.sleep(200)};
 await wheel(180,0);if(!await run('v.contentX>0'))throw Error('Column horizontal wheel failed');
 await wheel(0,100);await wait('v.contentY>0');
 console.log('PASS complete preview column horizontal and vertical wheel',await run('({x:v.contentX,y:v.contentY,cw:v.contentWidth,ch:v.contentHeight})'));
}finally{await browser.close();rmSync(qml,{force:true});rmSync(dir,{recursive:true,force:true})}
