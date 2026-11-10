import {test,expect} from 'bun:test';
import {previewHtml,html,HTML_LIMIT} from '../src/html.js';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
test('HTML is rebuilt with fixed tags, no source attributes, nested divs and literal entities',()=>{
 expect(previewHtml('<div id=x><div onclick="evil()">A &amp; B</div></div>')).toBe('<div><div>A &amp; B</div></div>');
 expect(previewHtml('<textarea><img src=x onerror="evil()"></textarea>')).toBe('&lt;img src=x onerror="evil()"&gt;');
 expect(previewHtml('<script>globalThis.__htmlProbe++</script><style>bad</style><p>OK</p>')).toBe('<p>OK</p>');
 expect(previewHtml('<svg><foreignObject><b>hidden</b></foreignObject></svg><p>OK</p>')).toBe('<p>OK</p>');
 expect(()=>previewHtml('x'.repeat(HTML_LIMIT+1))).toThrow();
});
test('HTML file replies are bounded and cancellation produces no result',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'flea-html-'));
 try{
  const path=join(dir,'test.html');await writeFile(path,'<h1 onmouseover="evil()">Hello</h1>');
  expect(await html({path,token:4,slot:'look'})).toMatchObject({state:'ready',html:'<h1>Hello</h1>',token:4,slot:'look'});
  expect(await html({path,cancel:true})).toBe(null);
  expect((await html({path:dir})).state).toBe('failed');
  await writeFile(path,'x'.repeat(HTML_LIMIT+1));expect((await html({path})).state).toBe('failed');
 }finally{await rm(dir,{recursive:true,force:true})}
});
