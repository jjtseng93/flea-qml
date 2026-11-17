// bun test/manual-settings-ui.mjs (requires sibling buninu-browser).
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const repo=Bun.fileURLToPath(new URL('../',import.meta.url));
const dir=await mkdtemp(join(tmpdir(),'flea-settings-'));
process.env.XDG_STATE_HOME=dir;
process.env.BUNINU_BUN=process.execPath;
const file=join(repo,'ui/boot/.settings-check-'+process.pid+'.qml');
await Bun.write(file,`import QtQuick
import Quickshell
import ".." as Flea
FloatingWindow {id:window;width:800;height:650;Flea.SettingsPanel{id:panel;anchors.fill:parent} Component.onCompleted:{globalThis.panel=panel;globalThis.state=Flea.ViewState;panel.open(window)}}`);
const {createBrowser}=await import('../../buninu-browser/lib/headless-shell.js');
const browser=await createBrowser({spareRenderer:false});
const run=s=>browser.context.evaluate(s);
async function until(s){for(let n=0;n<150;n++){if(await run(s))return;await Bun.sleep(100)}throw Error('Timeout: '+s)}
const count=()=>run('document.querySelectorAll("*").length');
try {
 await browser.context.navigate(Bun.pathToFileURL(file).href);
 await until('globalThis.panel?.opened && panel.rows.length>0');
 const first=await count();
 assert.ok(first>0);
 await Bun.sleep(1800);
 assert.equal(await count(),first,'unvisited sections must not be prebuilt');
 await run('panel.showSection("about")');
 const pkg=await Bun.file(join(repo,'package.json')).json();
 await until('panel.rows.some(r=>r.label==="Version" && r.value==='+JSON.stringify(pkg.version)+')');
 const second=await count();assert.ok(second>first);
 const bounds=await run(`(()=>{const e=[...document.querySelectorAll('[data-qml-type=Text]')].find(e=>e.textContent.startsWith('Flea QML is a cross-platform'));return {width:e.clientWidth,scroll:e.scrollWidth,height:e.getBoundingClientRect().height}})()`);
 assert.ok(bounds.height>20 && bounds.scroll<=bounds.width+1,JSON.stringify(bounds));
 await run('state.changeSetting("openMode","single")');
 await until('state.state.openMode==="single"');
 await run('panel.showSection("view")');
 await until('panel.rowItemForId("openMode").row.selected==="single"');
 assert.equal(await count(),second,'revisit reuses section objects');
 await run('panel.close()');await Bun.sleep(300);
 assert.equal(await count(),second,'closing must not start background builds');
 console.log('PASS lazy settings sections, wrapping, state refresh and cached reopening');
}finally{await browser.close();await rm(file,{force:true});await rm(dir,{recursive:true,force:true})}
