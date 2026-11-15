// bun test/manual-archive-here-ui.mjs (requires the sibling buninu-browser checkout).
import {mkdtempSync,mkdirSync,rmSync,existsSync} from 'node:fs';
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
 const {archive}=await import('../src/archiveops.js');
 const source=join(dir,'source');mkdirSync(source);
 for(let i=0;i<8;i++)await Bun.write(join(source,`file${i}.txt`),'test');
 await new Promise((resolve,reject)=>archive({op:'compress',paths:[source],dest:join(dir,'sample.zip'),format:'zip'},m=>{if(m.t==='archivedone')m.ok?resolve():reject(Error(m.err))}));
 await browser.context.navigate(Bun.pathToFileURL(file).href);
 await until('!!globalThis.testBody && !testBody.currentPane.listInFlight');
 await run('for(let i=0;i<testBody.currentPane.total;i++)if(testBody.currentPane.rowFor(i)?.n==="sample.zip")testBody.currentPane.selectOnly(i,0)');
 await until('testBody.currentPane.previewColumnItem?.meta?.topEntries===1');
 assert.equal(await run('testBody.currentPane.previewColumnItem.meta.entries'),9);
 console.log('PASS right preview carries 9 members / 1 top-level item');
 await run('testBody.currentPane.act("preview")');
 await until('testBody.currentPane.quickLook().archiveMeta?.topEntries===1');
 assert.equal(await run('testBody.currentPane.quickLook().archiveMeta.entries'),9);
 console.log('PASS Quick Look carries 9 members / 1 top-level item');
 const button=await run('(()=>{const e=[...document.querySelectorAll("[data-qml-type=Text]")].filter(e=>e.textContent==="Extract here"&&e.getBoundingClientRect().width>0).at(-1);const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()');
 await browser.context.click(button.x,button.y);
 for(let i=0;i<100&&!existsSync(join(dir,'source copy'));i++)await Bun.sleep(100);
 assert(existsSync(join(dir,'source copy')),'Extract here should run without confirmation');
 console.log('PASS clicking Quick Look Extract here extracts without a confirmation dialog');
 await run('testBody.currentPane.quickLook().close()');
 await until('!testBody.currentPane.listInFlight');
 await run('for(let i=0;i<testBody.currentPane.total;i++)if(testBody.currentPane.rowFor(i)?.n==="sample.zip")testBody.currentPane.selectOnly(i,0)');
 await until('testBody.currentPane.previewColumnItem?.meta?.topEntries===1');
 const right=await run('(()=>{const e=[...document.querySelectorAll("[data-qml-type=Text]")].find(e=>e.textContent==="Extract here"&&e.getBoundingClientRect().width>0);const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()');
 await browser.context.click(right.x,right.y);
 for(let i=0;i<100&&!existsSync(join(dir,'source copy 2'));i++)await Bun.sleep(100);
 assert(existsSync(join(dir,'source copy 2')),'right preview Extract here should run without confirmation');
 console.log('PASS clicking right preview Extract here extracts without confirmation');

}finally{await browser.close();rmSync(file,{force:true});rmSync(dir,{recursive:true,force:true});}
