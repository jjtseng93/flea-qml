// bun test/manual-html-ui.mjs; real backend + QML rich-text preview, no external resources.
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createBrowser} from '../../buninu-browser/lib/headless-shell.js';
const repo=Bun.fileURLToPath(new URL('../',import.meta.url));
const dir=await mkdtemp(join(tmpdir(),'flea-html-ui-'));
const qml=join(repo,'ui/boot/.html-check-'+process.pid+'.qml');
const path=join(dir,'preview.html');
process.env.BUNINU_BUN=process.execPath;
await Bun.write(path,'<h1 onclick="globalThis.__htmlProbe=1">HTML preview</h1><div><b>Bold</b> &amp; <i>italic</i><div>Nested div</div></div><textarea><img src=x onerror="globalThis.__htmlProbe=1"></textarea>'+ '<p>Scrollable text</p>'.repeat(80));
await Bun.write(qml,`import QtQuick\nimport Quickshell\nimport ".." as Flea\nFloatingWindow {width:640;height:480;color:"#171b22";Flea.Backend{id:backend} Loader {anchors.fill:parent;Component.onCompleted:setSource("${Bun.pathToFileURL(join(repo,'ui/PreviewHtml.qml')).href}");onLoaded:{item.backend=backend;item.path=${JSON.stringify(path)};item.active=true;globalThis.preview=item}}}`);
const browser=await createBrowser({spareRenderer:false});
try{
 await browser.context.navigate(Bun.pathToFileURL(qml).href);
 let ready=false;
 for(let i=0;i<150;i++){ready=await browser.context.evaluate('!!globalThis.preview && preview.contentReady');if(ready)break;await Bun.sleep(100)}
 if(!ready)throw Error('Preview never ready: '+await browser.context.evaluate('document.body.innerText'));
 const result=await browser.context.evaluate('({text:document.body.innerText,probe:globalThis.__htmlProbe||0,height:preview.viewport.contentHeight,viewport:preview.viewport.height})');
 if(!result.text.includes('Nested div')||result.probe||result.height<=result.viewport)throw Error(JSON.stringify(result));
 await browser.context.evaluate('preview.scrollBy(5)');
 if(!(await browser.context.evaluate('preview.scrollY > 0')))throw Error('Scroll failed');
 await browser.context.evaluate('preview.viewport.contentY=0');
 await Bun.write('/tmp/flea-html-preview.png',Buffer.from(await browser.context.screenshot({format:'png'}),'base64'));
 await browser.context.evaluate('preview.width=240');
 const boxes=await browser.context.evaluate(`(()=>{const e=document.querySelector('h1'),p=document.querySelector('p');return {heading:e.getBoundingClientRect(),paragraph:p.getBoundingClientRect(),content:preview.viewport.contentHeight}})()`);
 if(boxes.paragraph.top<boxes.heading.bottom)throw Error('Heading overlaps paragraph: '+JSON.stringify(boxes));
 await Bun.write('/tmp/flea-html-preview-narrow.png',Buffer.from(await browser.context.screenshot({format:'png'}),'base64'));
 console.log('PASS backend HTML, nested rich text, literal attack text and scrolling',result.height,result.viewport);
}finally{await browser.close();await rm(qml,{force:true});await rm(dir,{recursive:true,force:true})}
