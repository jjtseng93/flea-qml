import {test,expect} from 'bun:test';
import {readFileSync} from 'node:fs';
const read=name=>readFileSync(new URL('../ui/'+name,import.meta.url),'utf8');
const Menu=new Function(read('js/Menu.js').replace(/^\.(?:pragma|import).*$/gm,'')+';return {edgeRow};')();
const keys={ControlModifier:1,ShiftModifier:2,AltModifier:4,MetaModifier:8};
let next=100;
const Qt=new Proxy(keys,{get:(o,k)=>o[k]??(o[k]=next++)});
const Keymap=new Function('Qt',read('js/Keymap.js').replace(/^\.(?:pragma|import).*$/gm,'')+';return {lookupFor};')(Qt);
const body=/function jumpEdge\(last\) \{([\s\S]*?)\n    \}/.exec(read('ContextMenu.qml'))[1];
const jump=(root,last)=>new Function('root','Menu','last',body)(root,Menu,last);
test('Home and End work in menus under every preset, without consuming modified keys',()=>{
 for(const preset of ['default','vim','mac','windows']){
  expect(Keymap.lookupFor(preset,Qt.Key_Home,'',0,'menu','gui')).toBe('cursorFirst');
  expect(Keymap.lookupFor(preset,Qt.Key_End,'',0,'menu','gui')).toBe('cursorLast');
  expect(Keymap.lookupFor(preset,Qt.Key_Home,'',Qt.AltModifier,'menu','gui')).toBe('');
 }
});
test('menu edges skip disabled rows and separators in the active level only',()=>{
 const root={submenuOpen:false,cursor:2,submenuCursor:2,
  entries:[{separator:true},{disabled:true},{action:'one'},{action:'two'},{disabled:true}],
  submenuEntries:[{disabled:true},{id:'a'},{separator:true},{id:'b'},{separator:true}]};
 jump(root,true);expect(root.cursor).toBe(3);expect(root.submenuCursor).toBe(2);
 jump(root,false);expect(root.cursor).toBe(2);
 root.submenuOpen=true;
 jump(root,true);expect(root.submenuCursor).toBe(3);expect(root.cursor).toBe(2);
 jump(root,false);expect(root.submenuCursor).toBe(1);
 for(const rows of [[],[{separator:true}],[{disabled:true},{separator:true}]]){
  expect(Menu.edgeRow(rows,false)).toBe(-1);expect(Menu.edgeRow(rows,true)).toBe(-1);
 }
});
