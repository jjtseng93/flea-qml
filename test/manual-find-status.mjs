// Exercise the real status bar bindings, including completed Find and ordinary lists.
import {rm} from 'node:fs/promises';
import {createBrowser} from '../../buninu-browser/lib/headless-shell.js';
const qml=new URL('../ui/boot/.find-status-'+process.pid+'.qml',import.meta.url);
process.env.BUNINU_BUN=process.execPath;
await Bun.write(qml,`import QtQuick
import Quickshell
import ".." as Flea
FloatingWindow {
 width: 1000; height: 100; color: "#171b22"
 Flea.StatusBar {
  id: bar; width: parent.width
  listingState: "ready"; total: 2
  searchLine: "2 found in 0.4 s"; searchRunning: false
  pane: ({
   selectionVersion: 1, selection: {count: function(){return 0}, indices: function(){return []}},
   cursorIndex: 0, shown: null, shownTotal: 2, rows: [{n:"sub/完整的 long filename.txt",s:123}],
   cursorRow: {n:"sub/完整的 long filename.txt",s:123},
   rowFor: function(i){return this.rows[i]}
  })
  Component.onCompleted: globalThis.bar = bar
 }
}`);
const browser=await createBrowser({spareRenderer:false});
function assert(ok,message){if(!ok)throw Error(message)}
try{
 await browser.context.navigate(Bun.pathToFileURL(Bun.fileURLToPath(qml)).href);
 for(let i=0;i<100;i++){if(await browser.context.evaluate('!!globalThis.bar?.fileNameItem'))break;await Bun.sleep(50)}
 let state=await browser.context.evaluate('({shown:bar.showFileName,label:bar.fileLabel,count:bar.countText(),visible:bar.fileNameItem?.visible})');
 assert(state.shown&&state.visible&&state.label.includes('123')&&state.label.endsWith('完整的 long filename.txt'),JSON.stringify(state));
 assert(state.count==='2 found in 0.4 s',JSON.stringify(state));
 await browser.context.evaluate('bar.searchRunning=true');
 assert(await browser.context.evaluate('!bar.showFileName && bar.centreText()===bar.searchLine'),'live progress lost');
 await browser.context.evaluate('bar.searchRunning=false; bar.searchLine=""');
 assert(await browser.context.evaluate('bar.showFileName && bar.countText()==="2 items"'),'ordinary listing regressed');
 console.log('PASS Find filename, file size, completed summary, running progress and ordinary listing');
}finally{await browser.close();await rm(qml,{force:true})}
