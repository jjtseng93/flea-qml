import {test, expect} from 'bun:test';
import {readFileSync} from 'node:fs';
function load(name,names,deps={}) {
 const source=readFileSync(new URL('../ui/js/'+name+'.js',import.meta.url),'utf8').replace(/^\.(?:pragma|import).*$/gm,'');
 return new Function(...Object.keys(deps),source+';return {'+names+'};')(...Object.values(deps));
}
const qtValues={ControlModifier:1,ShiftModifier:2,AltModifier:4,MetaModifier:8};
let key=100;
const Qt=new Proxy(qtValues,{get:(o,k)=>o[k]??(o[k]=key++)});
const Keymap=load('Keymap','lookupFor',{Qt});
const BackReturn=load('BackReturn','pending,capture,drawn,pushedOnto,travel');
const Nav=load('Nav','open,back,openPlace',{BackReturn});
const Focus=load('Focus','act',{Nav,Status:{}});
test('Alt+Home is available in every preset, Home remains first-item',()=>{
 for(const preset of ['default','vim','mac','windows']){
  for(const context of ['listing','rail'])expect(Keymap.lookupFor(preset,Qt.Key_Home,'',Qt.AltModifier,context,'gui')).toBe('home');
  expect(Keymap.lookupFor(preset,Qt.Key_Home,'',0,'listing','gui')).toBe('cursorFirst');
 }
});
test('Alt+Home records current folder so H returns, and repeated Home adds no entry',()=>{
 const visits=[];
 const pane={path:'/work/docs',home:'/home/test',history:[],forwardHistory:[],cursorIndex:3,
  trash:{opened:false},listingState:'ready',rowFor:()=>({n:'note.md'}),
  open(path){Nav.open(this,path);},
  openWithoutHistory(path,options){visits.push({path,options});this.path=path;},
  goBack(){Nav.back(this);}
 };
 const home=Keymap.lookupFor('default',Qt.Key_Home,'',Qt.AltModifier,'listing','gui');
 Focus.act(home,pane);
 expect(pane.path).toBe('/home/test');
 expect(pane.history).toEqual([{path:'/work/docs',name:'note.md',index:3}]);
 Focus.act(home,pane);
 expect(visits.length).toBe(1);
 Focus.act(Keymap.lookupFor('default',Qt.Key_H,'H',Qt.ShiftModifier,'listing','gui'),pane);
 expect(pane.path).toBe('/work/docs');
 expect(visits[1].options.restore.name).toBe('note.md');
 expect(pane.forwardHistory[0].path).toBe('/home/test');
});

test('only Ctrl+W closes tabs; plain w still toggles preview wrapping',()=>{
 for(const preset of ['default','vim','mac','windows']){
  for(const context of ['listing','rail']){
   expect(Keymap.lookupFor(preset,Qt.Key_W,'w',0,context,'gui')).toBe('');
   expect(Keymap.lookupFor(preset,Qt.Key_W,'w',Qt.ControlModifier,context,'gui')).toBe('tabClose');
  }
  expect(Keymap.lookupFor(preset,Qt.Key_W,'w',0,'preview','gui')).toBe('toggleWrap');
 }
});

test('Default Ctrl+H toggles hidden files without replacing the existing dot shortcut',()=>{
 expect(Keymap.lookupFor('default',Qt.Key_H,'h',Qt.ControlModifier,'listing','gui')).toBe('toggleHidden');
 expect(Keymap.lookupFor('default',Qt.Key_Period,'.',0,'listing','gui')).toBe('toggleHidden');
 expect(Keymap.lookupFor('windows',Qt.Key_H,'h',Qt.ControlModifier,'listing','gui')).toBe('toggleHidden');
});
