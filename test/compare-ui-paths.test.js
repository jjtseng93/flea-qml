import {test,expect} from 'bun:test';
async function load(name,names,deps={}){
 const source=(await Bun.file(new URL('../ui/js/'+name+'.js',import.meta.url)).text()).replace(/^\.(?:pragma|import).*$/gm,'');
 return new Function(...Object.keys(deps),source+';return {'+names+'};')(...Object.values(deps));
}
const Lists=await load('Lists','isList');
const Format=await load('Format','S_IFMT,S_IFREG');
const Menu=await load('Menu','canCompare',{Lists,Format});
const Ops=await load('Ops','open',{Menu,Search:{baseOf:p=>p.path}});
test('Compare menu accepts POSIX, Windows drive and UNC paths, preserves listing order',()=>{
 for(const base of ['/tmp/','C:/dir/','C:\\dir\\','\\\\server\\share\\']){
  const calls=[],rows=[{n:'a.txt',p:33188},{n:'b.txt',p:33188}];
  const pane={path:base,selectedIndices:()=>[1,0],rowFor:i=>rows[i],
   join:(a,b)=>a+b,quickLook:()=>({openCompare:(...args)=>calls.push(args)})};
  Ops.open(pane);
  expect(calls[0]?.slice(0,2)).toEqual([base+'a.txt',base+'b.txt']);
  calls.length=0;
  Ops.open(pane,[base+'b.txt',base+'a.txt']);
  expect(calls[0]?.slice(0,2)).toEqual([base+'a.txt',base+'b.txt']);
  for(const bad of ['relative.txt','C:relative.txt','https://example.com/a']){
   calls.length=0;Ops.open(pane,[bad,base+'a.txt']);expect(calls).toEqual([]);
  }
 }
});
