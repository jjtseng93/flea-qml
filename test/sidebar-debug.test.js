import {test,expect} from 'bun:test';
const source=await Bun.file(new URL('../ui/Sidebar.qml',import.meta.url)).text();
const hint=source.slice(source.indexOf('id: sidebarHint'));
const expression=hint.match(/onClicked:\s*(\(async function\s*\(\)\s*\{[\s\S]*?\}\)\(\))/)?.[1];
if(!expression)throw Error('Missing sidebar debug handler');
const run=new Function('prompt','alert','return '+expression);
test('sidebar debug prompt cancellation does not evaluate or alert',async()=>{
 const messages=[];await run(()=>null,x=>messages.push(x));expect(messages).toEqual([]);
});
test('sidebar debug handler awaits evaluation and reports exceptions',async()=>{
 const messages=[];await run(()=>'Promise.resolve(42)',x=>messages.push(x));expect(messages).toEqual([42]);
 await run(()=>'{ throw new Error("debug test"); }',x=>messages.push(x));expect(messages[1]).toContain('debug test');
});
