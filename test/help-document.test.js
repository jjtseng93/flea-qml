import {test,expect} from 'bun:test';
import {readFileSync} from 'node:fs';
import {markdownHtml,MARKDOWN_LIMIT} from '../src/markdown-html.js';
const code=readFileSync(new URL('../ui/js/HelpDocument.js',import.meta.url),'utf8').replace(/^\.pragma.*$/m,'');
const extract=new Function(code+';return extract')();
test('help uses the complete bilingual usage chapter, excluding other chapters',()=>{
 const readme=readFileSync(new URL('../README.md',import.meta.url),'utf8');
 const result=extract(readme);
 expect(result).toStartWith('## How to use\n## 使用方法');
 expect(result).toContain('### Menus and dialogs');
 expect(result).not.toContain('## Runtime and supported features');
 expect(result).not.toContain('## Running it');
});
test('section extraction handles CRLF, code fences, and missing headings',()=>{
 expect(extract('## Before\r\n## 使用方法\r\n~~~md\r\n## example\r\n~~~\r\n### Child\r\nhi\r\n## After')).toBe('## 使用方法\n~~~md\n## example\n~~~\n### Child\nhi\n');
 expect(()=>extract('## Other')).toThrow('no How to use');
});
test('in-memory Markdown needs no backing file and retains sanitization and limits',async()=>{
 const path='/nonexistent/flea-help-memory/README.md';
 const answer=await markdownHtml({path,source:'# Help\n<script>alert(1)</script>\n[go](#help)',token:3});
 expect(answer.state).toBe('ready');
 expect(answer.html).toContain('id="help"');
 expect(answer.html).not.toContain('<script');
 expect((await markdownHtml({path,source:''})).state).toBe('ready');
 expect((await markdownHtml({path,source:'x'.repeat(MARKDOWN_LIMIT+1)})).state).toBe('failed');
});
