import { test, expect } from 'bun:test';
async function load(name, names, deps = {}) {
    const source = (await Bun.file(new URL('../ui/js/' + name + '.js', import.meta.url)).text())
        .replace(/^\.(?:pragma|import).*$/gm, '');
    return new Function(...Object.keys(deps), source + '; return {' + names + '};')(...Object.values(deps));
}
const Scroll = await load('Scroll', 'limitsY,stopTail,tailState');
const keys = await load('PreviewKeys', 'act,pdfAction,columnPdfAction,pageDirection,pageViewport', { Scroll });
test('page actions scroll Quick Look without changing the selected file', () => {
    const calls = [];
    const root = { preview: { revealStrip() {}, pageBy: n => calls.push(n) } };
    for (const action of ['pageDown', 'pageUp', 'previewPageForward', 'previewPageBack']) keys.act(action, root);
    expect(calls).toEqual([1, -1, 1, -1]);
});
test('both PDF key routes handle every page alias', () => {
    for (const handler of [keys.pdfAction, keys.columnPdfAction]) {
        const calls = [];
        const viewer = { pageBy: n => calls.push(n) };
        for (const action of ['pageDown', 'pageUp', 'previewPageForward', 'previewPageBack']) handler(action, viewer);
        expect(calls).toEqual([1, -1, 1, -1]);
    }
});
test('viewport paging respects origin, margins, bounds, and stops wheel momentum', () => {
    let cancelled = 0, layouts = 0;
    const view = { originY: 100, topMargin: 10, bottomMargin: 20, height: 200,
        contentHeight: 700, contentY: 90, cancelFlick() { cancelled++; }, forceLayout() { layouts++; } };
    const tail = Scroll.tailState(view, true); tail.active = true; tail.vy = 2;
    keys.pageViewport(view, 1); expect(view.contentY).toBe(290);
    keys.pageViewport(view, 1); keys.pageViewport(view, 1); expect(view.contentY).toBe(620);
    for (let i = 0; i < 5; i++) keys.pageViewport(view, -1);
    expect(view.contentY).toBe(90);
    expect(tail.active).toBe(false); expect(tail.vy).toBe(0);
    expect(cancelled).toBe(8); expect(layouts).toBe(8);
    view.contentHeight = 20; keys.pageViewport(view, 1); expect(view.contentY).toBe(90);
    keys.pageViewport(null, 1);
});
test('Ctrl-Tab returns from Quick Look like Escape', () => {
    let closed = 0;
    keys.act('focusPreview', { preview: { revealStrip() {}, close() { closed++; } } });
    expect(closed).toBe(1);
});
