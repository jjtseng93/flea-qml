// Integration regression: bun test/manual-sidebar-toggle.mjs (requires sibling buninu-browser).
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,mkdirSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const dir=mkdtempSync(join(tmpdir(),'flea-sidebar-'));
process.env.XDG_STATE_HOME=dir;
process.env.FLEA_PATH=dir;
const {createBrowser}=await import('../../buninu-browser/lib/headless-shell.js');
const initiallyHidden=process.argv.includes('--hidden');
mkdirSync(join(dir,'flea'));
writeFileSync(join(dir,'flea','ui.json'),JSON.stringify({places:{rail:initiallyHidden?'hidden':'shown'}}));
const browser=await createBrowser({spareRenderer:false});
try {
 await browser.context.navigate(new URL('../ui/boot/shell.qml',import.meta.url).href);
 const evaluate=code=>browser.context.evaluate(code);
 for(let n=0;n<80;n++){
  if(await evaluate("[...document.querySelectorAll('[aria-label]')].some(e=>e.getAttribute('aria-label')==='Home')"))break;
  await Bun.sleep(150);
 }
 assert.equal(await evaluate(`(()=>{
  const row=[...document.querySelectorAll('[aria-label]')].find(e=>e.getAttribute('aria-label')==='Home');
  let e=row;
  while(e && e.parentElement?.getAttribute('data-qml-type')!=='Loader')e=e.parentElement;
  globalThis.railForTest=e;
  return !!e;
 })()`),true);
 assert.equal(await evaluate("railForTest.parentElement.style.display !== 'none'"),!initiallyHidden);
 for(let round=0;round<3;round++){
  for(const shown of (initiallyHidden?[true,false]:[false,true])){
   await evaluate("document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'b',code:'KeyB',ctrlKey:true,bubbles:true,cancelable:true}))");
   await Bun.sleep(350);
   assert.equal(await evaluate("railForTest.isConnected"),true,'Sidebar must stay alive');
   assert.equal(await evaluate("railForTest.parentElement.style.display !== 'none'"),shown);
   if(shown)assert.equal(await evaluate("railForTest.innerText.includes('Home')"),true,'Places rows must return');
  }
 }
 console.log('PASS: startup '+(initiallyHidden?'hidden':'shown')+' creates Places; three Ctrl+B cycles retain Sidebar');
} finally {
 await browser.close();
 rmSync(dir,{recursive:true,force:true});
}
