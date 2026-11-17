import {test, expect} from 'bun:test';
import {readFileSync} from 'node:fs';
const source = readFileSync(new URL('../ui/js/Menu.js', import.meta.url), 'utf8');
const load = () => new Function(source.replace(/^\.(?:pragma|import).*$/gm, '') + `
 return {availableEntry, shouldQueryApplications, enable(value){OPEN_WITH_ENABLED=value}};
`)();

test('Open with is absent before and after provider replies, without discovery; Open remains', () => {
 const menu = load();
 for (const state of [{}, {openWithLoaded:true,openWithApps:[]},
   {openWithLoaded:true,openWithApps:[{id:'editor.desktop',label:'Editor'}]}]) {
  expect(menu.availableEntry({action:'openWith'}, state, 'F')).toBe(false);
  expect(menu.availableEntry({action:'open'}, state, 'F')).toBe(true);
 }
 expect(menu.shouldQueryApplications(true,1,true,true)).toBe(false);
});

test('one capability switch restores discovery and the existing flyout', () => {
 const menu = load(); menu.enable(true);
 expect(menu.shouldQueryApplications(true,1,true,true)).toBe(true);
 for (const args of [[false,1,true,true],[true,2,true,true],[true,1,false,true],[true,1,true,false]])
  expect(menu.shouldQueryApplications(...args)).toBe(false);
 const entry={action:'openWith'};
 expect(menu.availableEntry(entry,{openWithLoaded:true,openWithApps:[{id:'editor.desktop',label:'Editor',default:true}]},'F')).toBe(true);
 expect(entry.submenu[0]).toEqual({id:'editor.desktop',label:'Editor',icon:'',hint:'default'});
 expect(entry.submenu.at(-1).id).toBe('__another__');
 expect(menu.availableEntry({action:'openWith'},{openWithLoaded:true,openWithApps:[]},'F')).toBe(false);
});
