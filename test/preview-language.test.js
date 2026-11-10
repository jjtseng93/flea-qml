import {test,expect} from 'bun:test';
import {previewLanguage} from '../src/preview-language.js';
import {code} from '../src/code.js';
const hint=(text,path='main.v')=>previewLanguage(path,Buffer.from(text));
test('V declarations distinguish .v source without stealing Verilog',()=>{
 expect(hint('module main\nfn main() { println("hello") }')).toBe('v');
 expect(hint('pub fn (a App) run() {}')).toBe('v');
 expect(hint('fn map[T](x T) T { return x }')).toBe('v');
 expect(hint('module main;\nendmodule')).toBeNull();
 expect(hint('// fn main() {}\nmodule main;\nendmodule')).toBeNull();
 expect(hint('/* fn main() {} */')).toBeNull();
 expect(hint('"fn main() {}"')).toBeNull();
 expect(hint('module main')).toBeNull();
 expect(hint('fn main() {}','main.txt')).toBeNull();
});
test('V and Verilog both retain source text and colour through the real preview launcher',async()=>{
 for(const text of ['module main\nfn main() { println("hello") }\n','module counter(input clk);\nreg value;\nendmodule\n']) {
  const reply=await code({name:'main.v',text});
  expect(reply.state).toBe('styled');
  expect(reply.lines.map(r=>r.filter((_,i)=>i%2).join('')).join('\n')).toBe(text.trimEnd());
 }
});
