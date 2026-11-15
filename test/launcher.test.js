import {test,expect} from 'bun:test';
import {EventEmitter} from 'node:events';
import {browserPackage,browserCommand,selectFrontend,detectKitty,entryURL} from '../index.js';
import {fileURLToPath} from 'node:url';
import info from '../package.json';
import {isAbsolute} from 'node:path';

test('launcher follows browser package manager order',()=>{
 const which = names => name => names.includes(name) ? '/bin/'+name : null;
 expect(browserCommand(['file:///a%20b.qml'],which(['npx','bun','bunx']))).toEqual(['/bin/npx','--loglevel=error','-p',browserPackage(),'--','buninu-browser','file:///a%20b.qml']);
 expect(browserCommand([],which(['npx','bunx']))).toEqual(['/bin/bunx',browserPackage()]);
 expect(browserCommand([],which(['bun']))).toEqual(['/bin/bun','x',browserPackage()]);
 expect(browserCommand([],which([]),'/running/bun')).toEqual(['/running/bun','x',browserPackage()]);
 expect(isAbsolute(fileURLToPath(entryURL))).toBe(true);
});
test('explicit frontends override detection on Windows and Linux',()=>{
 expect(selectFrontend([],true,'win32').frontend).toBe('--casty');
 expect(selectFrontend([],false,'win32').frontend).toBe('--win32');
 for(const platform of ['linux','android']) expect(selectFrontend([],false,platform).frontend).toBe('--wayland');
 for(const flag of ['--casty','--wayland','--win32','--headless']) expect(selectFrontend([flag,'--help'],true,'win32')).toEqual({frontend:flag,args:['--help']});
 expect(selectFrontend(['--future-frontend','arg'],false)).toEqual({frontend:'--future-frontend',args:['arg']});
});
function terminal(reply) {
 const input=new EventEmitter(),output=new EventEmitter();
 input.isTTY=output.isTTY=true;input.isRaw=false;input.paused=true;
 input.isPaused=()=>input.paused;input.pause=()=>{input.paused=true;};input.resume=()=>{input.paused=false;};input.setRawMode=v=>{input.isRaw=v;};input.unshift=()=>{};
 output.write=query=>{const id=/i=(\d+)/.exec(query)[1];if(reply!==null)queueMicrotask(()=>{input.emit('data',Buffer.from(`\x1b_Gi=${id};${reply}\x1b`));input.emit('data',Buffer.from('\\'));});};
 return {input,output};
}
test('graphics query handles fragmented replies and restores terminal on timeout',async()=>{
 for(const [reply,expected] of [['OK',true],['OK Buninu1 bgra',true],['EINVAL',false],[null,false]]) {
  const {input,output}=terminal(reply);
  expect(await detectKitty(input,output,5)).toBe(expected);
  expect(input.isRaw).toBe(false);expect(input.paused).toBe(true);expect(input.listenerCount('data')).toBe(0);
 }
 expect(await detectKitty({isTTY:false},{isTTY:true})).toBe(false);
});

test('browser package comes from the script without shell execution',()=>{
 expect(browserPackage()).toBe(info.scripts.browser.split(/\s+/)[1]);
 expect(browserPackage('bunx buninu-browser@9.8.7')).toBe('buninu-browser@9.8.7');
 expect(()=>browserPackage('bunx buninu-browser@1; echo bad')).toThrow();
});

test('version flags report the package and pinned browser versions', async()=>{
 for (const flag of ['--version','-V']) {
  const child = Bun.spawn([process.execPath, fileURLToPath(new URL('../index.js', import.meta.url)), flag], {stdout:'pipe',stderr:'pipe'});
  expect(await new Response(child.stdout).text()).toBe(`flea-qml ${info.version}\n${browserPackage()} (pinned)\n`);
  expect(await child.exited).toBe(0);
 }
});
