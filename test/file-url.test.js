import {test,expect} from 'bun:test';
import {readFileSync} from 'node:fs';

function loadFunction(file,name,scope={}) {
 const source=readFileSync(new URL(file,import.meta.url),'utf8');
 const match=source.match(new RegExp('^( *)function '+name+'\\(path\\) \\{([\\s\\S]*?)^\\1\\}', 'm'));
 if(!match)throw Error('Missing '+name);
 return new Function(...Object.keys(scope),`return (${match[0].trim()})`)(...Object.values(scope));
}
const format=loadFunction('../ui/js/Format.js','fileUri');
const boot=loadFunction('../ui/boot/shell.qml','fileUrl');
const drag=loadFunction('../ui/js/Drag.js','uriFor',{Format:{fileUri:format}});
const cases=[
 ['C:\\Users\\wxk\\AppData\\Local\\Temp\\flea\\ui\\boot/../WindowBody.qml','file:///C:/Users/wxk/AppData/Local/Temp/flea/ui/boot/../WindowBody.qml'],
 ['C:/Users/a b/中文#?%.qml','file:///C:/Users/a%20b/%E4%B8%AD%E6%96%87%23%3F%25.qml'],
 ['\\\\server\\share\\a b.png','file://server/share/a%20b.png'],
 ['/home/a b/#?%.png','file:///home/a%20b/%23%3F%25.png'],
 ['/home/a\\b.png','file:///home/a%5Cb.png'],
];
for(const [name,convert] of [['boot',boot],['preview',format],['drag',drag]]) {
 test(name+' file URLs preserve Windows drives, UNC and POSIX path bytes',()=>{
  for(const [path,url] of cases){expect(convert(path)).toBe(url);expect(new URL(convert(path)).protocol).toBe('file:');}
 });
}
