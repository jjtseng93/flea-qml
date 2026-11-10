// bun test/manual-html-security.mjs; uses sibling browser, with scripts enabled.
// The attack only increments a harmless global counter. Never run raw fixtures.
import {previewHtml,HTML_TAGS} from '../src/html.js';
import {createBrowser} from '../../buninu-browser/lib/headless-shell.js';
const probe='globalThis.__htmlProbe=(globalThis.__htmlProbe||0)+1';
const payloads=[`<img src=x onerror="${probe}">`,`<script>${probe}</script>`,`<svg onload="${probe}"></svg>`,`<iframe srcdoc="<script>${probe}</script>"></iframe>`,`<p onclick="${probe}">click</p>`,'&lt;img src=x onerror=alert(1)&gt;','<!--><img src=x onerror="'+probe+'">'];
const wrappers=['div','textarea','plaintext','xmp','title','noscript','select','option','table','svg','math','template','script','style','iframe'];
const inputs=[];
for(const a of wrappers)for(const b of wrappers)for(const p of payloads)inputs.push(`<${a}><${b}>${p}</${a}></${b}><p>tail</p>`);
inputs.push('<math><mtext><table><mglyph><style><!--</style><img title="--><img src=x onerror='+probe+'>">');
const outputs=inputs.map(previewHtml);
const browser=await createBrowser({spareRenderer:false});
try{
 await browser.context.navigate('about:blank');
 // First prove the harmless probe works in this execution context.
 await browser.context.evaluate(probe);
 if(await browser.context.evaluate('globalThis.__htmlProbe')!==1)throw Error('Probe did not execute');
 await browser.context.evaluate(`globalThis.__htmlProbe=0;globalThis.__bad=[];const allowed=new Set(${JSON.stringify([...HTML_TAGS])});for(const html of ${JSON.stringify(outputs)}){const host=document.createElement('div');host.innerHTML=html;document.body.appendChild(host);for(const el of host.querySelectorAll('*')){if(!allowed.has(el.localName)||el.attributes.length||el.namespaceURI!=='http://www.w3.org/1999/xhtml')__bad.push(el.outerHTML);el.dispatchEvent(new Event('click'));el.dispatchEvent(new Event('error'));el.dispatchEvent(new Event('load'));}host.remove();}`);
 await Bun.sleep(100);
 const result=await browser.context.evaluate('({executed:__htmlProbe,bad:__bad})');
 if(result.executed||result.bad.length)throw Error(JSON.stringify(result));
 console.log('PASS',outputs.length,'adversarial fragments; no illegal elements/attributes or script execution');
}finally{await browser.close()}
