// Rebuild a passive fragment. Never use HTMLRewriter's transformed source output.
import { open, constants } from 'node:fs/promises';
export const HTML_TAGS = new Set('div h1 h2 h3 h4 h5 h6 p br b strong i em u s del pre code ul ol li blockquote table thead tbody tr th td hr sub sup'.split(' '));
const OMIT = new Set('script style iframe object embed template svg math noembed noframes head'.split(' '));
export const HTML_LIMIT = 1 << 20;
export function previewHtml(source) {
  if (Buffer.byteLength(source) > HTML_LIMIT) throw Error('HTML preview exceeds size limit');
  const result = []; let hidden = 0;
  new HTMLRewriter().on('*', { element(el) {
    const tag = el.tagName;
    const omit = OMIT.has(tag) || el.namespaceURI !== 'http://www.w3.org/1999/xhtml';
    if (omit && el.canHaveContent) { hidden++; el.onEndTag(() => hidden--); }
    if (omit || hidden || !HTML_TAGS.has(tag)) return;
    result.push('<' + tag + '>');
    if (el.canHaveContent) el.onEndTag(() => result.push('</' + tag + '>'));
  }}).onDocument({ text(chunk) {
    // Text callbacks include literal markup inside textarea/xmp/plaintext. It
    // must stay text on reparse. Entities are NOT decoded before reconstruction.
    if (!hidden) result.push(chunk.text.replaceAll('<', '&lt;').replaceAll('>', '&gt;'));
  }}).transform(source);
  return result.join('');
}
export async function html(request) {
  const answer = {t:'html', slot:request.slot, token:request.token, state:'failed', html:'', total:0};
  if (request.cancel) return null;
  let file;
  try {
    file = await open(request.path, constants.O_RDONLY | constants.O_NONBLOCK);
    const stat = await file.stat();
    if (!stat.isFile() || stat.size > HTML_LIMIT) return answer;
    const bytes = Buffer.alloc(HTML_LIMIT + 1); let count = 0;
    while (count < bytes.length) {
      const {bytesRead} = await file.read(bytes, count, bytes.length-count, null);
      if (!bytesRead) break;
      count += bytesRead;
    }
    if (count > HTML_LIMIT) return answer;
    const source = bytes.subarray(0,count).toString('utf8');
    return {...answer,state:'ready',html:previewHtml(source),total:source ? source.split('\n').length : 0};
  } catch { return answer; }
  finally { await file?.close(); }
}
