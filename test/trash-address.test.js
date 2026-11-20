import {test,expect} from 'bun:test';
async function load(name,names,deps={}) {
 const source=(await Bun.file(new URL('../ui/js/'+name+'.js',import.meta.url)).text()).replace(/^\.(?:pragma|import).*$/gm,'');
 return new Function(...Object.keys(deps),source+';return {'+names+'};')(...Object.values(deps));
}
const PathBar=await load('PathBar','isTrashRoot,addressTarget,editLine,shouldNavigate',{Format:{}});
const Crumbs=await load('Crumbs','crumbs');
test('Trash root aliases canonicalize only at the address input boundary',()=>{
 for(const value of ['trash:/','trash://','trash:///',' TRASH:/// ']) {
  expect(PathBar.isTrashRoot(value)).toBe(true);
  expect(PathBar.addressTarget(value,'/home/test','/home/test')).toBe('trash:///');
 }
 for(const value of ['trash:','trash:////','trash://host/','trash:///file','/tmp/trash:','trash'])expect(PathBar.isTrashRoot(value)).toBe(false);
 expect(PathBar.addressTarget('/tmp','trash:///','/home/test')).toBe('/tmp');
 expect(PathBar.addressTarget('~','trash:///','/home/test')).toBe('/home/test');
 expect(PathBar.addressTarget('tmp','trash:///','/home/test')).toBe('/tmp');
 expect(PathBar.addressTarget('tmp','/','/home/test')).toBe('/tmp');
 expect(PathBar.addressTarget('tmp','//server/share/','/home/test')).toBe('//server/share/tmp');
});
test('Trash root remains a single breadcrumb and does not gain a fourth slash',()=>{
 expect(PathBar.editLine('trash:///')).toBe('trash:///');
 expect(PathBar.editLine('/tmp')).toBe('/tmp/');
 expect(Crumbs.crumbs('trash:///','/home/test',null)).toEqual([{text:'trash:///',path:'trash:///',last:true}]);
 expect(PathBar.shouldNavigate('trash:///','trash:///',false)).toBe(false);
});
