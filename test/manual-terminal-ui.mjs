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
await Bun.write(file,`import QtQuick\nimport Quickshell\nimport ".." as Flea\nFloatingWindow { id: win; width:900; height:600; Loader {anchors.fill:parent; source:"../WindowBody.qml";onLoaded:{item.host=win;globalThis.testBody=item;globalThis.terminalService=Flea.TerminalService}} }`);
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
 await run('testBody.currentPane.openTerminal()');
 await until('Object.values(terminalService.tabs).length===2 && Object.values(terminalService.tabs).every(t=>t.url?.includes("reconnect-token"))');
 const urls=await run('Object.values(terminalService.tabs).map(t=>t.url)');
 assert.equal(new URL(urls[0]).host,new URL(urls[1]).host);assert.notEqual(urls[0],urls[1]);
 assert.equal(await run('testBody.currentPane.tabs.items.length'),3);
 console.log('PASS two terminal tabs, shared listener, distinct sessions',new URL(one).port);
 // Child frame text confirms scripts load; input/PTY tested separately by the wire test.
 await Bun.sleep(12000);
 const target=new URL(urls[1]);
 const monitor=new WebSocket(target.origin+target.pathname.replace(/\/$/,'/ws').replace(/^http/,'ws'),'webtty');
 let output='';
 monitor.onopen=()=>monitor.send(JSON.stringify({AuthToken:'',ReadOnly:true,ReconnectToken:target.searchParams.get('reconnect-token')}));
 monitor.onmessage=e=>{const data=String(e.data);if(data[0]==='1')output+=Buffer.from(data.slice(1),'base64').toString();};
 await Bun.sleep(200);
 assert.equal(await run('document.activeElement.tagName'),'TEXTAREA','new terminal must own keyboard without a click');
 for(const key of "printf '%s%s\\n' FLEA_ QTWEB_OK")await browser.context.press(key);
 await browser.context.press('Enter');
 for(let i=0;i<100&&!output.includes('FLEA_QTWEB_OK');i++)await Bun.sleep(100);
 monitor.close();
 assert(output.includes('FLEA_QTWEB_OK'),'Keyboard did not reach terminal: '+output);
 console.log('PASS keyboard traverses QML WebEngineView to its PTY');
 await Bun.write('/tmp/flea-terminal-tabs.png',Buffer.from(await browser.context.screenshot({format:'png'}),'base64')); 
 console.log('canvas',await run('[...document.querySelectorAll("canvas")].map(c=>({w:c.width,h:c.height,box:c.getBoundingClientRect().toJSON()}))'));
 console.log('frames',await run('[...document.querySelectorAll("iframe")].map(f=>({src:f.src,text:f.contentDocument?.body?.innerText?.slice(-500)}))'));
}finally{await browser.close();rmSync(file,{force:true});rmSync(dir,{recursive:true,force:true});}
