import {test,expect} from 'bun:test';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../ui/js/UiState.js',import.meta.url),'utf8').replace(/^\.(?:pragma|import).*$/gm,'');
const UiState=new Function(source+';return {writerStopped,settlerStopped};')();
test('a successful settings writer can stop before or after its exit signal',()=>{
 for(const order of ['stop-first','exit-first']){
  const queue=[],codes=[];
  const root={writerSerial:1,writeBook:{inflight:'{"hidden":true}'},wrote(code){codes.push(code);this.writerSerial++;this.writeBook.inflight='';}};
  const child={running:false};
  if(order==='exit-first')root.wrote(0);
  UiState.writerStopped(root,child,fn=>queue.push(fn));
  if(order==='stop-first')root.wrote(0);
  queue.forEach(fn=>fn());
  expect(codes).toEqual([0]);
 }
});
test('actual spawn failure is reported, but an old stop cannot fail the next save',()=>{
 const queue=[],codes=[];
 const root={writerSerial:1,writeBook:{inflight:'patch'},wrote:code=>codes.push(code)};
 const child={running:false};
 UiState.writerStopped(root,child,fn=>queue.push(fn));
 queue.shift()();expect(codes).toEqual([2]);
 codes.length=0;
 UiState.writerStopped(root,child,fn=>queue.push(fn));
 root.writerSerial++;
 queue.shift()();expect(codes).toEqual([]);
});
test('settings refresh accepts late exit code and ignores stops from previous runs',()=>{
 const queue=[],answers=[];
 const root={settleSerial:1,settleMode:'apply',settleAnswer:{text:'{}'},settleLanded:answer=>answers.push(answer)};
 const child={running:false};
 UiState.settlerStopped(root,child,fn=>queue.push(fn));
 root.settleAnswer.code=0;
 queue.shift()();expect(answers).toEqual([]);
 root.settleAnswer={};
 UiState.settlerStopped(root,child,fn=>queue.push(fn));
 root.settleSerial++;
 queue.shift()();expect(answers).toEqual([]);
 UiState.settlerStopped(root,child,fn=>queue.push(fn));
 queue.shift()();expect(answers.length).toBe(1);expect(answers[0].code).not.toBe(0);
});
