// bun test/manual-terminal-ui.mjs (requires the sibling buninu-browser checkout).
import {mkdtempSync,mkdirSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import assert from 'node:assert/strict';
const repo=Bun.fileURLToPath(new URL('../',import.meta.url));
const dir=mkdtempSync(join(tmpdir(),'flea-terminal-ui-'));
process.env.XDG_DATA_HOME=join(dir,'data');process.env.XDG_CONFIG_HOME=join(dir,'config');process.env.XDG_CACHE_HOME=join(dir,'cache');process.env.FLEA_PATH=dir;process.env.BUNINU_BUN=process.execPath;
for(const p of ['data','config','cache'])mkdirSync(join(dir,p));
const {createBrowser}=await import('../../buninu-browser/lib/headless-shell.js');
const file=join(repo,'ui/boot/.terminal-check-'+process.pid+'.qml');
await Bun.write(file,`import QtQuick\nimport Quickshell\nimport ".." as Flea\nimport "../js/Tabs.js" as Tabs\nFloatingWindow { id: win; width:900; height:600; Loader {anchors.fill:parent; source:"../WindowBody.qml";onLoaded:{item.host=win;globalThis.testTabs=Tabs;globalThis.testBody=item;globalThis.terminalService=Flea.TerminalService}} }`);
const browser=await createBrowser({spareRenderer:false});
const run=s=>browser.context.evaluate(s);
const until=async(s)=>{for(let i=0;i<200;i++){if(await run(s))return;await Bun.sleep(100);}throw Error('UI timeout '+s+' '+await run('document.body.innerText.slice(-2500)'));};
try {
 await browser.context.navigate(Bun.pathToFileURL(file).href);
 await until('!!globalThis.testBody && !testBody.currentPane.listInFlight');
 await run('testBody.currentPane.openTerminal()');
 await until('!!testBody.currentPane.terminalId');
 await until('Object.values(terminalService.tabs).some(t=>t.url?.includes("reconnect-token"))');
 const one=await run('Object.values(terminalService.tabs)[0].url');



 await until('!!document.querySelector("canvas")');
 await browser.context.click(400,100);
 await run('testTabs.selectAt(testBody.currentPane,0)');
 await Bun.sleep(100);
 console.log('ordinary focus',await run('({focus:testBody.currentPane.activeFocus,active:document.activeElement.tagName,id:testBody.currentPane.terminalId})'));
 const cursor=await run('testBody.currentPane.cursorIndex');
 await browser.context.press('ArrowDown');
 assert.equal(await run('testBody.currentPane.cursorIndex'),cursor+1,'ArrowDown must reach the ordinary list');
 await browser.context.press('ArrowUp');
 assert.equal(await run('testBody.currentPane.cursorIndex'),cursor);
 await browser.context.press('t');
 assert.equal(await run('testBody.currentPane.tabs.items.length'),3,'ordinary t must work after terminal switch');
 await browser.context.press('t',{modifiers:2,code:'KeyT'});
 assert.equal(await run('testBody.currentPane.tabs.items.length'),4,'Ctrl+T must open another terminal');
 console.log('PASS terminal -> ordinary -> arrows -> t -> Ctrl+T');
 await run('testTabs.closeAt(testBody.currentPane,testBody.currentPane.tabs.index)');
 await Bun.sleep(100);
 assert.equal(await run('testBody.currentPane.activeFocus'),true,'closing terminal returns focus');
 await browser.context.press('t',{modifiers:2,code:'KeyT'});
 assert.equal(await run('testBody.currentPane.tabs.items.length'),4);
 console.log('PASS close terminal -> ordinary -> Ctrl+T');

}finally{await browser.close();rmSync(file,{force:true});rmSync(dir,{recursive:true,force:true});}
