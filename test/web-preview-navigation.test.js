import {test, expect} from 'bun:test';
import {readFileSync} from 'node:fs';

const source = readFileSync(new URL('../ui/WebPreviewView.qml', import.meta.url), 'utf8');
const fragment = source.match(/function isDocumentFragment\(target\) \{[\s\S]*?\n    \}/)[0];
const handler = source.match(/onNavigationRequested: (function \(request\) \{[\s\S]*?\n    \})/)[1];
function preview(url) {
  const external = [];
  const view = {url, linkActivated: target => external.push(target)};
  view.isDocumentFragment = new Function('view', `return (${fragment})`)(view);
  const navigate = new Function('view', 'WebEngineNavigationRequest', `return (${handler})`)(view, {LinkClickedNavigation:0});
  return target => {
    let rejected = false;
    navigate({url:target, navigationType:0, reject(){rejected=true;}});
    return {rejected, external:[...external]};
  };
}
test('preview accepts local fragments but keeps external and relative navigation intercepted', () => {
  for (const current of ['', 'about:srcdoc', 'about:blank', 'about:blank#old']) {
    for (const target of ['#title', '#', '#中文', (current.split('#')[0] || 'about:blank') + '#title'])
      expect(preview(current)(target)).toEqual({rejected:false,external:[]});
  }
  expect(preview('')('about:srcdoc#title')).toEqual({rejected:false,external:[]});
  for (const target of ['https://example.com/#title', 'mailto:a@b.c', './other.md#title', 'javascript:alert(1)'])
    expect(preview('about:srcdoc')(target)).toEqual({rejected:true,external:[target]});
});


test('only the current document can use the hash-navigation exception', () => {
  for (const target of ['about:blank#x', 'about:srcdoc/other#x', 'file:///etc/passwd#x',
    'data:text/html,<script>alert(1)</script>#x', 'javascript:alert(1)#x', '//example.com/#x',
    'https://example.com/#x', './other.md#x', 'about:srcdoc?other#x']) {
    expect(preview('about:srcdoc')(target)).toEqual({rejected:true,external:[target]});
  }
  expect(preview('about:srcdoc#old')('about:srcdoc#new')).toEqual({rejected:false,external:[]});
});
