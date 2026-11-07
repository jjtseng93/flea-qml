import {test,expect} from 'bun:test';
async function load(name,names,deps={}) {
 const s=(await Bun.file(new URL('../ui/js/'+name+'.js',import.meta.url)).text()).replace(/^\.(?:pragma|import).*$/gm,'');
 return new Function(...Object.keys(deps),s+';return {'+names+'};')(...Object.values(deps));
}
const Find=await load('Find','expression');
test('Find uses path matching for forward slashes, without rewriting Windows queries',()=>{
 expect(Find.expression('ReadMe',true)).toEqual(['-iname','*ReadMe*']);
 expect(Find.expression('src/ReadMe',true)).toEqual(['-ipath','*src/ReadMe*']);
 expect(Find.expression('*/src/*.js',true)).toEqual(['-ipath','*/src/*.js']);
 expect(Find.expression('src/File',false)).toEqual(['-mindepth','1','-name','.*','-prune','-o','-ipath','*src/File*','-print']);
});
test('focused Find owns Escape; focused Filter and listing close Filter first',async()=>{
 const calls=[];
 const Focus=await load('Focus','handleKey',{
  Qt:{Key_Escape:27},Status:{NO_TRASH:''},
  Filter:{close:r=>{calls.push('filter');r.filterTyping=false;r.filterQuery='';}},
  Search:{abort:r=>{calls.push('find');r.searchMode='';},TYPING:'typing'},
  shareBrowserHere:()=>false
 });
 const root={selectionBand:null,renameEditor:()=>null,filterTyping:true,filterQuery:'test',searchMode:'typing'};
 Focus.handleKey({key:27},root,null,'find');
 expect(calls).toEqual(['find']);expect(root.filterQuery).toBe('test');
 root.searchMode='typing';
 Focus.handleKey({key:27},root,null,'filter');
 expect(calls).toEqual(['find','filter']);expect(root.searchMode).toBe('typing');
 root.filterQuery='again';
 Focus.handleKey({key:27},root,null);
 expect(calls).toEqual(['find','filter','filter']);expect(root.searchMode).toBe('typing');
});

test('leaving Find preserves Filter through the directory relist',async()=>{
 const Search=await load('Search','abort');
 let options;
 const root={searchMode:'results',searchQuery:'item',searchGen:2,searchOpenedGen:1,
  searchFrom:'/tmp/files',path:'/tmp/files',filterQuery:'00',backend:{searchClose(){}},
  openWithoutHistory:(path,ask)=>{expect(path).toBe('/tmp/files');options=ask;}};
 Search.abort(root);
 expect(options).toEqual({holdWalk:true,relist:true,keptQuery:'00'});
});

test('focused Find Escape stops a running search, then closes only Find',async()=>{
 const Search=await load('Search','abort');
 const calls=[];
 const Focus=await load('Focus','handleKey',{
  Qt:{Key_Escape:27},Status:{NO_TRASH:''},Search,
  Filter:{close:()=>{throw Error('Find Escape must not close Filter')}},
  shareBrowserHere:()=>false
 });
 const root={selectionBand:null,renameEditor:()=>null,
  searchMode:'typing',searchQuery:'x',searchRunning:true,searchGen:1,searchOpenedGen:0,
  path:'/tmp',filterQuery:'keep',backend:{searchCancel:()=>calls.push('cancel'),searchClose:()=>calls.push('close')},
  openWithoutHistory:(path,ask)=>calls.push(ask.keptQuery)};
 Focus.handleKey({key:27},root,null,'find');
 expect(calls).toEqual(['cancel']);
 expect(root.searchMode).toBe('typing');
 expect(root.searchQuery).toBe('x');
 expect(root.searchLeaving).not.toBe(true);
 expect(root.filterQuery).toBe('keep');
 // The backend's cancellation reply marks the search stopped.
 root.searchRunning=false;
 Focus.handleKey({key:27},root,null,'find');
 expect(root.searchLeaving).toBe(true);
 expect(root.filterQuery).toBe('keep');
 expect(calls).toEqual(['cancel','close','keep']);
});
