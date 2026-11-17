import {expect, test} from 'bun:test';

const ui = new URL('../ui/', import.meta.url);
const source = await Bun.file(new URL('js/DesktopIntegration.js', ui)).text();
const defaults = new Function(source.replace(/^\.pragma.*$/gm, '') + ';return {enabled};')();
async function method(file, name, scope) {
  const text = await Bun.file(new URL(file, ui)).text();
  const match = text.match(new RegExp('^( *)function ' + name + '\\(([^)]*)\\) \\{([\\s\\S]*?)^\\1\\}', 'm'));
  if (!match) throw Error('Missing QML method: ' + name);
  return new Function(...Object.keys(scope), 'return function(' + match[2] + '){' + match[3] + '}')(...Object.values(scope));
}

test('desktop integration defaults off; one switch restores all Style probes', async () => {
  expect(defaults.enabled).toBe(false);
  const flag = {...defaults};
  const hyprctlProc = {running:false}, gapsOutProc = {running:false}, animationsProc = {running:false}, fcMatchProc = {running:false};
  let refreshes = 0;
  const scope = {DesktopIntegration:flag, hyprctlProc, gapsOutProc, animationsProc, fcMatchProc, refreshTimer:{restart(){refreshes++;}}};
  const methods = await Promise.all(['refresh', 'scheduleRefresh', 'resolveFontFamily'].map(name => method('boot/Commons/Style.qml', name, scope)));
  for (const fn of methods) fn();
  expect([hyprctlProc.running, gapsOutProc.running, animationsProc.running, fcMatchProc.running, refreshes]).toEqual([false,false,false,false,0]);
  flag.enabled = true;
  for (const fn of methods) fn();
  expect([hyprctlProc.running, gapsOutProc.running, animationsProc.running, fcMatchProc.running, refreshes]).toEqual([true,true,true,true,1]);
});

test('disabled tagging paths never start direct or shell-wrapped hyprctl', async () => {
  // No other dependencies: reaching the retained implementation would throw.
  for (const name of ['retag','probe','apply']) {
    const fn = await method('GlassTagger.qml', name, {DesktopIntegration:defaults});
    expect(() => fn([])).not.toThrow();
  }
  const start = await method('Glass.qml', 'startTagger', {DesktopIntegration:defaults});
  expect(() => start()).not.toThrow();
});

test('disabled drag geometry clears stale position without spawning; switch restores query', async () => {
  const flag = {...defaults}, root = {rect:{x:1},queryDrained:true}, query = {running:false};
  const begin = await method('TabDragGeometry.qml', 'begin', {DesktopIntegration:flag,root,query});
  begin('first', {});
  expect(root.rect).toBe(null);
  expect(query.running).toBe(false);
  flag.enabled = true;
  begin('second', {});
  expect(root.queryToken).toBe('second');
  expect(query.running).toBe(true);
});
