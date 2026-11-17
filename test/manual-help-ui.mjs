// bun test/manual-help-ui.mjs (requires the sibling buninu-browser checkout).
import {mkdtempSync,mkdirSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import assert from 'node:assert/strict';
const repo=Bun.fileURLToPath(new URL('../',import.meta.url));
const dir=mkdtempSync(join(tmpdir(),'flea-terminal-ui-'));
process.env.XDG_STATE_HOME=join(dir,'state');process.env.XDG_DATA_HOME=join(dir,'data');process.env.XDG_CONFIG_HOME=join(dir,'config');process.env.XDG_CACHE_HOME=join(dir,'cache');process.env.FLEA_PATH=dir;process.env.BUNINU_BUN=process.execPath;
for(const p of ['state','data','config','cache'])mkdirSync(join(dir,p));
await Bun.write(join(dir,'notes.txt'),'line of preview text\n'.repeat(200));
const {createBrowser}=await import('../../buninu-browser/lib/headless-shell.js');
const file=join(repo,'ui/boot/.help-check-'+process.pid+'.qml');
await Bun.write(file,`import QtQuick\nimport Quickshell\nimport ".." as Flea\nimport "../js/Tabs.js" as Tabs\nFloatingWindow { id: win; width:900; height:600; Loader {anchors.fill:parent; focus:true; source:"../WindowBody.qml";onLoaded:{item.host=win;globalThis.testTabs=Tabs;globalThis.testBody=item;globalThis.terminalService=Flea.TerminalService}} }`);
const browser=await createBrowser({spareRenderer:false});
const run=s=>browser.context.evaluate(s);
const until=async(s)=>{for(let i=0;i<200;i++){if(await run(s))return;await Bun.sleep(100);}throw Error('UI timeout '+s+' '+await run('document.body.innerText.slice(-2500)'));};
try {
 await browser.context.navigate(Bun.pathToFileURL(file).href);
 await until('!!globalThis.testBody && !testBody.currentPane.listInFlight');
 await run('document.activeElement.dispatchEvent(new KeyboardEvent("keydown",{key:"?",code:"Slash",shiftKey:true,bubbles:true,cancelable:true}))');
 await until('testBody.quickLook && testBody.quickLook.active && testBody.quickLook.status === "ready"');
 console.log('help ready', await run('({text:testBody.quickLook.textShown().slice(0,70),memory:testBody.quickLook.markdownText!==null})'));
 assert.equal(await run('testBody.quickLook.textShown().includes("### Menus and dialogs")'),true);
 assert.equal(await run('testBody.quickLook.textShown().includes("## Runtime and supported features")'),false);
 await browser.context.press('Escape');
 await until('!testBody.quickLook.active');
 await Bun.sleep(400);
 const pos=await run('(()=>{const s=testBody.currentPane.sidebar; const i=s.entries.findIndex(e=>e.kind==="help");const r=__qmlRuntime.element(s.railItemFor(i)).getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()');
 await browser.context.click(pos.x,pos.y);
 await until('testBody.quickLook.active && testBody.quickLook.status === "ready"');
 assert.equal(await run('testBody.quickLook.markdownText.startsWith("## How to use")'),true);
 await run('testBody.quickLook.toggleMarkdownView()');
 await until('testBody.quickLook.markdownView() === "source" && testBody.quickLook.status === "ready"');
 assert.equal(await run('testBody.quickLook.textShown().includes("## Runtime and supported features")'),false);
 await browser.context.press('Escape');
 await until('!testBody.quickLook.active && testBody.currentPane.listArea.activeFocus');
 console.log('PASS help via shortcut and Places uses the same Quick Look with in-memory chapter');
} finally {await browser.close();rmSync(file,{force:true});rmSync(dir,{recursive:true,force:true});}
