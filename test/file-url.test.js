import {test,expect} from 'bun:test';
import {readFileSync} from 'node:fs';

function loadFunction(file,name,scope={}) {
 const source=readFileSync(new URL(file,import.meta.url),'utf8');
 const match=source.match(new RegExp('^( *)function '+name+'\\([^)]*\\) \\{([\\s\\S]*?)^\\1\\}', 'm'));
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

const picker=loadFunction('../ui/boot/picker.qml','fileUrl');
for(const [name,convert] of [['boot',boot],['picker',picker],['preview',format],['drag',drag]]) {
 test(name+' resolves parent paths after mixed or repeated directory separators',()=>{
  for(const base of ['C:\\ui\\boot\\','C:/ui/boot/','C:/ui/boot//']) {
   expect(new URL(convert(base+'/../WindowBody.qml')).href).toBe('file:///C:/ui/WindowBody.qml');
  }
  expect(new URL(convert('\\\\server\\share\\boot\\/../PickerWindow.qml')).href).toBe('file://server/share/PickerWindow.qml');
  expect(new URL(convert('/home/ui/boot//../WindowBody.qml')).href).toBe('file:///home/ui/WindowBody.qml');
 });
}

test('address bar accepts Windows absolute paths and does not climb above drive/share roots',()=>{
 const source=readFileSync(new URL('../ui/js/PathBar.js',import.meta.url),'utf8').replace(/^\.(pragma|import).*$/gm,'');
 const bar=new Function('Format',source+';return {resolve,normalize};')({});
 expect(bar.resolve('C:\\Users\\name','D:/elsewhere','C:/Users/me')).toBe('C:/Users/name');
 expect(bar.resolve('file:///C:/Users/a%20b','D:/elsewhere','')).toBe('C:/Users/a b');
 expect(bar.resolve('../next','C:/Users/me','')).toBe('C:/Users/next');
 expect(bar.normalize('C:/../../')).toBe('C:/');
 expect(bar.normalize('\\\\server\\share\\dir\\..\\..\\..')).toBe('//server/share');
 expect(bar.normalize('/home/a\\b')).toBe('/home/a\\b');
});

test('parent navigation preserves drive and UNC share roots',()=>{
 const trimSlash=loadFunction('../ui/js/Nav.js','trimSlash');
 const parentOf=loadFunction('../ui/js/Nav.js','parentOf',{trimSlash});
 expect(parentOf('C:/Users')).toBe('C:/');
 expect(parentOf('C:/')).toBe('C:/');
 expect(parentOf('C:\\Users\\name')).toBe('C:/Users');
 expect(parentOf('//server/share/dir')).toBe('//server/share');
 expect(parentOf('//server/share')).toBe('//server/share');
 expect(parentOf('/home/name')).toBe('/home');
});

test('Windows file URLs decode to usable drive paths for drop, recent and Markdown previews',()=>{
 const drop=loadFunction('../ui/js/DragOut.js','filePath');
 const recent=loadFunction('../ui/js/Recent.js','pathOf');
 const markdown=loadFunction('../ui/js/MarkdownPrepared.js','pathOfUrl',{FILE_SCHEME_LENGTH:7});
 for(const convert of [drop,recent,markdown]) {
  expect(convert('file:///C:/Users/a%20b.txt')).toBe('C:/Users/a b.txt');
  expect(convert('file:///home/a%5Cb.txt')).toBe('/home/a\\b.txt');
 }
});
