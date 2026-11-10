// Actual JS backend -> bunmsh -cc builtin diff -> QML CompareView.
import {mkdtemp,rm} from 'node:fs/promises';import {join} from 'node:path';import {tmpdir} from 'node:os';
import {createBrowser} from '../../buninu-browser/lib/headless-shell.js';
const dir=await mkdtemp(join(tmpdir(),'flea-compare-ui-'));
const repo=Bun.fileURLToPath(new URL('../',import.meta.url));
const qml=join(repo,'ui/boot/.compare-'+process.pid+'.qml');
const a=join(dir,'before.txt'),b=join(dir,'after.txt');
process.env.BUNINU_BUN=process.execPath;
await Bun.write(a,'first\nold\nlast\n');await Bun.write(b,'first\nnew\nlast\n');
await Bun.write(qml,`import QtQuick\nimport Quickshell\nimport ".." as Flea\nFloatingWindow{width:640;height:480;color:"#171b22";Flea.Backend{id:backend} Flea.CompareView{id:view;anchors.fill:parent;backend:backend;active:true;pathA:${JSON.stringify(a)};pathB:${JSON.stringify(b)};Component.onCompleted:globalThis.comparison=view}}`);
const browser=await createBrowser({spareRenderer:false});
try{
 await browser.context.navigate(Bun.pathToFileURL(qml).href);
 let state;for(let i=0;i<100;i++){state=await browser.context.evaluate('globalThis.comparison?.answer');if(state)break;await Bun.sleep(100)}
 if(state!=='diff')throw Error('Compare answer: '+state);
 const kinds=await browser.context.evaluate('comparison.rows.map(r=>r.kind)');
 if(!kinds.includes('removed')||!kinds.includes('added'))throw Error(JSON.stringify(kinds));
 await Bun.write('/tmp/flea-compare.png',Buffer.from(await browser.context.screenshot({format:'png'}),'base64'));
 console.log('PASS real backend and QML CompareView',kinds);
}finally{await browser.close();await rm(qml,{force:true});await rm(dir,{recursive:true,force:true})}
