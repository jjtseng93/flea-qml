import {test,expect} from 'bun:test';
async function load(name,names,deps={}) {
 const source=(await Bun.file(new URL('../ui/js/'+name+'.js',import.meta.url)).text()).replace(/^\.(?:pragma|import).*$/gm,'');
 return new Function(...Object.keys(deps),source+';return {'+names+'};')(...Object.values(deps));
}
const Match=await load('Match','rowName');
const Status=await load('Status','fileName',{Match});
const rows=[{n:'folder/完整的 very long file name.txt'},{n:'Trash/files/name.2',trash:{name:'Original.txt'}},{n:'other.txt'}];
function pane(selected=[],cursorIndex=0){return {selection:{indices:()=>selected},cursorIndex,shown:null,rowFor:i=>rows[i]??null};}
test('status names a single selection, or the current row without marks',()=>{
 expect(Status.fileName(pane())).toBe('完整的 very long file name.txt');
 expect(Status.fileName(pane([1]))).toBe('Original.txt');
 expect(Status.fileName(pane([0,1],2))).toBe('other.txt');
});
test('status clears absent, filtered or stale cursor names',()=>{
 expect(Status.fileName(null)).toBe('');
 expect(Status.fileName(pane([],50))).toBe('');
 expect(Status.fileName({...pane(),shown:[]})).toBe('');
 expect(Status.fileName({...pane(),listInFlight:true})).toBe('');
});
