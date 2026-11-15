// bun test/manual-terminal-ui.mjs (requires the sibling buninu-browser checkout).
import {mkdtempSync,mkdirSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import assert from 'node:assert/strict';
const repo=Bun.fileURLToPath(new URL('../',import.meta.url));
const dir=mkdtempSync(join(tmpdir(),'flea-terminal-ui-'));
process.env.XDG_DATA_HOME=join(dir,'data');process.env.XDG_CONFIG_HOME=join(dir,'config');process.env.XDG_CACHE_HOME=join(dir,'cache');process.env.FLEA_PATH=dir;process.env.BUNINU_BUN=process.execPath;
for(const p of ['data','config','cache'])mkdirSync(join(dir,p));
await Bun.write(join(dir,'notes.txt'),'line of preview text\n'.repeat(200));
const {createBrowser}=await import('../../buninu-browser/lib/headless-shell.js');
const file=join(repo,'ui/boot/.terminal-check-'+process.pid+'.qml');
await Bun.write(file,`import QtQuick\nimport Quickshell\nimport ".." as Flea\nimport "../js/Tabs.js" as Tabs\nFloatingWindow { id: win; width:900; height:600; Loader {anchors.fill:parent; source:"../WindowBody.qml";onLoaded:{item.host=win;globalThis.testTabs=Tabs;globalThis.testBody=item;globalThis.terminalService=Flea.TerminalService}} }`);
const browser=await createBrowser({spareRenderer:false});
const run=s=>browser.context.evaluate(s);
const until=async(s)=>{for(let i=0;i<200;i++){if(await run(s))return;await Bun.sleep(100);}throw Error('UI timeout '+s+' '+await run('document.body.innerText.slice(-2500)'));};
try {
 await browser.context.navigate(Bun.pathToFileURL(file).href);
 await until('!!globalThis.testBody && !testBody.currentPane.listInFlight');

 await run('testBody.currentPane.act("newFolder")');
 await until('testBody.currentPane.renamingIndex>=0 && document.activeElement.tagName==="INPUT"');
 await browser.context.type('Created Folder');
 await browser.context.press('Enter');
 await until('testBody.currentPane.renamingIndex<0 && !testBody.currentPane.listInFlight');
 await until('testBody.currentPane.activeFocus');
 await Bun.sleep(300);
 const before=await run('testBody.currentPane.cursorIndex');
 await browser.context.press(before>0?'ArrowUp':'ArrowDown');
 assert.equal(await run('testBody.currentPane.cursorIndex'),before>0?before-1:before+1);
 console.log('PASS mkdir + rename + ArrowDown');
 await run('document.activeElement.blur()');
 const pos=await run('(()=>{const r=__qmlRuntime.element(testBody.currentPane.visibleItemFor(Array.from({length:testBody.currentPane.total},(_,i)=>i).find(i=>testBody.currentPane.rowFor(i)?.n==="notes.txt"))).getBoundingClientRect();return {x:r.x+40,y:r.y+r.height/2}})()');
 await browser.context.click(pos.x,pos.y);
 await until('testBody.currentPane.activeFocus');
 const clicked=await run('testBody.currentPane.cursorIndex');
 await browser.context.press('ArrowUp');
 assert.equal(await run('testBody.currentPane.cursorIndex'),clicked-1);
 console.log('PASS clicking row recovers list focus from BODY');
 // Empty list space also takes focus, independently of a row TapHandler.
 const point=async expr=>run(`(()=>{const r=__qmlRuntime.element(${expr}).getBoundingClientRect();return {x:r.x+r.width/2,y:r.bottom-15}})()`);
 await run('document.activeElement.blur()');
 const ground=await point('testBody.currentPane.listArea');
 await browser.context.click(ground.x,ground.y);
 await until('testBody.currentPane.listArea.activeFocus');
 console.log('PASS empty listing ground takes focus');
 await run('document.activeElement.blur()');
 const rail=await point('testBody.currentPane.sidebar');
 await browser.context.click(rail.x,rail.y);
 await until('testBody.currentPane.sidebar.activeFocus');
 const railIndex=await run('testBody.currentPane.sidebar.cursorIndex');
 await browser.context.press('ArrowDown');
 assert.equal(await run('testBody.currentPane.sidebar.cursorIndex'),railIndex+1);
 console.log('PASS Places empty ground takes focus and arrow keys');
 await run('testBody.currentPane.focusView="list";for(let i=0;i<testBody.currentPane.total;i++)if(testBody.currentPane.rowFor(i)?.n==="notes.txt")testBody.currentPane.selectOnly(i,0)');
 await until('!!testBody.currentPane.previewColumnItem?.visible');
 const preview=await point('testBody.currentPane.previewColumnItem');
 await run('document.activeElement.blur()');
 await browser.context.click(preview.x,preview.y);
 await until('testBody.currentPane.previewColumnItem.activeFocus');
 console.log('PASS preview ground takes keyboard focus');

}finally{await browser.close();rmSync(file,{force:true});rmSync(dir,{recursive:true,force:true});}
