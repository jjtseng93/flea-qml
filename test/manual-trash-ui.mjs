// Run: bun test/manual-trash-ui.mjs (requires ../buninu-browser). Uses temporary fixtures only.
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
const repo=Bun.fileURLToPath(new URL('../',import.meta.url));
const dir=mkdtempSync(join(tmpdir(),'flea-trash-ui-'));
process.env.XDG_DATA_HOME=join(dir,'data');process.env.XDG_CONFIG_HOME=join(dir,'config');process.env.XDG_CACHE_HOME=join(dir,'cache');process.env.HOME=dir;process.env.FLEA_PATH=dir;process.env.BUNINU_BUN=process.execPath;
for(const p of ['data','config','cache'])mkdirSync(join(dir,p));
const {trashOne}=await import('../src/trash.js');
writeFileSync(join(dir,'preview.txt'),'HELLO TRASH PREVIEW\nline two');trashOne(join(dir,'preview.txt'));
writeFileSync(join(dir,'other.txt'),'SECOND');trashOne(join(dir,'other.txt'));
mkdirSync(join(dir,'folder'));writeFileSync(join(dir,'folder','child'),'child');trashOne(join(dir,'folder'));
const {createBrowser}=await import('../../buninu-browser/lib/headless-shell.js');
const file=join(repo,'ui/boot/.trash-check-'+process.pid+'.qml');
await Bun.write(file,`import QtQuick\nimport Quickshell\nimport ".." as Flea\nFloatingWindow { id: win; width:900; height:600; Loader {id:body; anchors.fill:parent; Component.onCompleted:{globalThis.testLoader=body;setSource("${Bun.pathToFileURL(join(repo,"ui/WindowBody.qml")).href}")} onStatusChanged:console.log("TESTLOADER",status) ; onLoaded:{item.host=win;globalThis.testBody=item}} }`);
const browser=await createBrowser({spareRenderer:false});
const run=s=>browser.context.evaluate(s);
try {
 await browser.context.addInitScript(`globalThis.compileErrors=[];const compile=__qmlHost.compile;__qmlHost.compile=(...a)=>{try{return compile(...a)}catch(e){compileErrors.push(String(e));throw e}}`);
 await browser.context.navigate(Bun.pathToFileURL(file).href);
 console.log('loaded',await run('document.body.innerText.slice(0,5000)'));
 for(let i=0;i<30;i++){if(await run('!!globalThis.testBody && !testBody.currentPane.listInFlight'))break;await Bun.sleep(100)}
 if(!await run('!!globalThis.testBody'))throw Error('testBody missing '+JSON.stringify(await run('({status:globalThis.testLoader?.status,source:globalThis.testLoader?.source,text:document.body.innerText,errors:globalThis.compileErrors})'))) ;
 console.log('initial',await run('({text:document.body.innerText.slice(0,150),mode:testBody.currentPane.recentMode})'));
 for(const address of ['trash:/','trash://','trash:///']) {
  if(await run('testBody.currentPane.recentMode === "trash"')) {
   await run('testBody.currentPane.closeRecent()');
   for(let i=0;i<150;i++){if(await run('!testBody.currentPane.listInFlight'))break;await Bun.sleep(100)}
  }
  await run(`testBody.currentPane.chromeBar.startEdit();testBody.currentPane.chromeBar.pathField.text=${JSON.stringify(address)};testBody.currentPane.chromeBar.commitEdit()`);
  for(let i=0;i<150;i++){if(await run('!testBody.currentPane.listInFlight'))break;await Bun.sleep(100)}
  if(!await run('testBody.currentPane.recentMode === "trash" && testBody.currentPane.path === "/" && testBody.currentPane.chromeBar.path === "trash:///"'))throw Error('Trash address failed: '+address);
 }
 await run('testBody.currentPane.chromeBar.startEdit()');
 if(await run('testBody.currentPane.chromeBar.editText')!=='trash:///')throw Error('Trash edit address acquired an extra slash');
 await run('testBody.currentPane.chromeBar.closeEdit()');
 console.log('PASS all Trash address aliases, display and unchanged backing path');
 const paths=await run('testBody.currentPane.rows.map(r=>r.trash.original)');
 if(paths.length!==3 || paths.some(p=>!p.startsWith(dir+'/')))throw Error('External trash detected; refusing mutation');
 console.log('trash',await run('({text:document.body.innerText,mode:testBody.currentPane.recentMode,rows:testBody.currentPane.total,cursor:testBody.currentPane.cursorRow})'));
 await run('testBody.currentPane.setCursor(testBody.currentPane.rows.findIndex(r=>r.n.endsWith("preview.txt")))');
 if(await run('testBody.currentPane.statusBar.selectedName')!=='preview.txt')throw Error('Trash status filename is not the original name');
 if(!await run('testBody.currentPane.statusBar.fileNameItem.visible && testBody.currentPane.statusBar.fileNameItem.width > 0'))throw Error('Status filename has no visible space');
 console.log('PASS status filename uses the original Trash name');
 // Exercise only the presentation component with a name wider than the window;
 // keep the actual fixture paths and operation identities untouched.
 await run('testBody.currentPane.statusBar.fileNameItem.name="完整檔案名稱-".repeat(40)+".txt"');
 await Bun.sleep(100);
 if(!await run('testBody.currentPane.statusBar.fileNameItem.contentWidth > testBody.currentPane.statusBar.fileNameItem.width'))throw Error('Long status filename cannot scroll');
 await run('testBody.currentPane.statusBar.fileNameItem.contentX=testBody.currentPane.statusBar.fileNameItem.contentWidth-testBody.currentPane.statusBar.fileNameItem.width');
 if(!await run('testBody.currentPane.statusBar.fileNameItem.contentX > 0'))throw Error('Long status filename did not scroll');
 if(process.env.FLEA_STATUS_SCREENSHOT)await Bun.write(process.env.FLEA_STATUS_SCREENSHOT,Buffer.from(await browser.context.screenshot({format:'png'}),'base64'));
 await run('testBody.currentPane.statusBar.fileNameItem.name=testBody.currentPane.statusBar.fileLabel');
 if(await run('testBody.currentPane.statusBar.fileNameItem.contentX')!==0)throw Error('New filename did not reset scrolling');
 console.log('PASS long status filename scrolling and reset');
 await run('testBody.currentPane.act("preview")');await Bun.sleep(2000);
 if(!await run('testBody.quickLookActive && document.body.innerText.includes("HELLO TRASH PREVIEW")'))throw Error('preview missing');
 if(process.env.FLEA_TRASH_SCREENSHOT)await Bun.write(process.env.FLEA_TRASH_SCREENSHOT,Buffer.from(await browser.context.screenshot({format:'png'}),'base64'));
 console.log('preview',await run('({active:testBody.quickLookActive,text:document.body.innerText.slice(-900)})'));
 await run('testBody.currentPane.quickLook().close()');
 await run('testBody.currentPane.act("filter");testBody.currentPane.filterQuery="preview"');
 await Bun.sleep(150);
 if(await run('testBody.currentPane.shown.length')!==1)throw Error('filter failed');
 await run('testBody.currentPane.filterQuery="";testBody.currentPane.filterTyping=false');
 const wait=async predicate=>{for(let i=0;i<200;i++){if(await run(predicate))return;await Bun.sleep(50)}throw Error('Timed out: '+predicate)};
 await run('testBody.currentPane.open(testBody.currentPane.join("/",testBody.currentPane.rows.find(r=>r.d).n))');
 await wait('!testBody.currentPane.listInFlight && testBody.currentPane.recentMode===""');
 await run('testBody.currentPane.goBack()');
 await wait('!testBody.currentPane.listInFlight && testBody.currentPane.recentMode==="trash"');
 console.log('PASS filter and directory Back');
 await run('testBody.currentPane.setCursor(testBody.currentPane.rows.findIndex(r=>r.n.endsWith("preview.txt")));testBody.currentPane.trash.action("deletePermanently")');
 await wait('testBody.currentPane.trash.confirmationOpen');
 await run('testBody.currentPane.trash.confirmation.cancel()');
 await wait('!testBody.currentPane.trash.busy');
 await run('testBody.currentPane.trash.action("restoreTrashSelection")');
 await wait('!testBody.currentPane.trash.busy && !testBody.currentPane.listInFlight && testBody.currentPane.total===2');
 if(!await Bun.file(join(dir,'preview.txt')).exists())throw Error('restore missing');
 console.log('PASS cancel deletion and restore selected');
 await run('testBody.currentPane.trash.action("emptyTrash")');
 await wait('testBody.currentPane.trash.confirmationOpen');
 // Opening the review is safe; never activate Empty Trash in a test, because
 // mount-local trashes can exist outside the isolated HOME/XDG directories.
 await run('testBody.currentPane.trash.confirmation.cancel()');
 await wait('!testBody.currentPane.trash.busy');
 console.log('PASS Empty Trash review and cancellation');
}finally{browser.close();rmSync(file,{force:true});rmSync(dir,{recursive:true,force:true})}
