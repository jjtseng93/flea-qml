import {test,expect} from 'bun:test';
async function load(name,exports,deps={}) {
 const source=(await Bun.file(new URL('../ui/js/'+name+'.js',import.meta.url)).text()).replace(/^\.(?:pragma|import).*$/gm,'');
 return new Function(...Object.keys(deps),source+';return {'+exports+'};')(...Object.values(deps));
}
const Icons=await load('Icons','isEmoji');
const Format=await load('Format','isSymlink');

test('emoji and directory rows never load language components, even during Find',async()=>{
 const Lang=await load('LangMarks','slugForRow,syncMark',{Icons,Format,Qt:{createComponent(){throw Error('unnecessary component load')}}});
 for(const row of [{n:'main.js',i:'📄',p:33188},{n:'code.py',i:'🐍',p:33188},{n:'folder.rs',d:true}]) {
  const owner={langSlug:Lang.slugForRow(row),thumbDrawn:false,langLoader:null};
  expect(owner.langSlug).toBe('');
  Lang.syncMark(owner,{parent:{}},'LangMarkLoader.qml',1);
  expect(owner.langLoader).toBeNull();
 }
});

test('visible language logos load once and release when replaced by emoji or thumbnails',async()=>{
 let loads=0,released=0,componentReleased=0;
 const Lang=await load('LangMarks','slugForRow,syncMark',{Icons,Format,Qt:{createComponent(){loads++;return {
  status:1,createObject(){return {active:true,destroy(){released++;}}},destroy(){componentReleased++;}
 };}}});
 const owner={langSlug:Lang.slugForRow({n:'main.js',i:'file',p:33188}),thumbDrawn:false,langLoader:null};
 const glyph={parent:{}};
 expect(owner.langSlug).toBe('javascript');
 Lang.syncMark(owner,glyph,'LangMarkLoader.qml',1);
 Lang.syncMark(owner,glyph,'LangMarkLoader.qml',1);
 expect(loads).toBe(1);expect(componentReleased).toBe(1);
 owner.langSlug=Lang.slugForRow({n:'main.js',i:'📄',p:33188});
 Lang.syncMark(owner,glyph,'LangMarkLoader.qml',1);
 expect(released).toBe(1);expect(owner.langLoader).toBeNull();
 owner.langSlug='javascript';owner.thumbDrawn=true;
 Lang.syncMark(owner,glyph,'LangMarkLoader.qml',1);
 expect(loads).toBe(1);
});
