import {test,expect} from 'bun:test';
async function load(name,names,deps={}) {
 const source=(await Bun.file(new URL('../ui/js/'+name+'.js',import.meta.url)).text()).replace(/^\.(?:pragma|import).*$/gm,'');
 return new Function(...Object.keys(deps),source+';return {'+names+'};')(...Object.values(deps));
}
test('Back from a trashed directory restores its collection and cursor, not filesystem root',async()=>{
 const Back=await load('BackReturn','capture,travel');
 const pane={path:'/',recentMode:'trash',recentFrom:'/home/test',cursorIndex:3,rowFor:()=>({n:'tmp/Trash/files/folder'})};
 const entry=Back.capture(pane);
 let opened=0;
 Object.assign(pane,{path:'/tmp/Trash/files/folder',recentMode:'',history:[entry],forwardHistory:[],
  trash:{open(){opened++}},join:(base,name)=>base+name,
  openWithoutHistory(){throw Error('must not navigate to /')}});
 Back.travel(pane,'history','forwardHistory');
 expect(opened).toBe(1);expect(pane.recentFrom).toBe('/home/test');expect(pane.pendingSelect).toBe('/tmp/Trash/files/folder');
 expect(pane.forwardHistory[0].path).toBe('/tmp/Trash/files/folder');
});
test('Trash Filter uses the visible original name, not its collision-safe storage name',async()=>{
 const Match=await load('Match','run,base,rowName');
 const Filter=await load('Filter','shown',{Match});
 const rows=[{n:'tmp/Trash/files/report.2',trash:{original:'/docs/report'}},{n:'tmp/Trash/files/elsewhere',trash:{original:'/docs/notes'}}];
 expect(Filter.shown(rows,10,'report')).toEqual([10]);
 expect(Filter.shown(rows,10,'report.2')).toEqual([]);
});
test('Find in the virtual Trash cannot silently search the previous directory',async()=>{
 const Search=await load('Search','start');let message='';
 const pane={recentMode:'trash',path:'/',recentFrom:'/private',message:m=>message=m};
 Search.start(pane);
 expect(pane.path).toBe('/');expect(pane.recentMode).toBe('trash');expect(message).toContain('filters');
});

test('Trash captions share original basenames in list, grid and columns',async()=>{
 const Match=await load('Match','rowName');
 expect(Match.rowName({n:'tmp/Trash/files/report.2',trash:{original:'/docs/report'}},false)).toBe('report');
 expect(Match.rowName({n:'C:/Trash/files/report.2',trash:{original:'C:\\docs\\report',name:'report'}},true)).toBe('report');
 expect(Match.rowName({n:'sub/file.txt'},false)).toBe('sub/file.txt');
});
