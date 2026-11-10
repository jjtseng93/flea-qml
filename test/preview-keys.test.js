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
test('HTML Quick Look arrows follow adjacent files, including media, rather than scrolling HTML', async () => {
    const followed = [], moved = [];
    const rows = [{n:'1.html',i:1,s:110,k:0},{n:'1.mp3',i:2,s:200,k:1}];
    const root = {cursorIndex:0,kindNames:['HTML','Audio'],join:(base,name)=>base+'/'+name,
        rowFor:i=>rows[i],preview:{isHtml:true,isCompare:false,
            markdownShown:{shownView:'rendered',scrollBy(){throw Error('Arrow must change file');}},
            revealStrip(){},follow:(...args)=>followed.push(args)}};
    const actions=await load('PreviewKeys','act',{
        Filter:{moveCursor(r,n){r.cursorIndex+=n;moved.push(n);},cursorShown:()=>true},
        Marks:{follow(){}},Search:{baseOf:()=>'/test'},Scroll,
    });
    actions.act('cursorDown',root);
    expect(followed[0].slice(0,4)).toEqual(['/test/1.mp3',2,200,'Audio']);
    actions.act('cursorUp',root);
    expect(followed[1][0]).toBe('/test/1.html');
    root.preview.isCompare=true;
    actions.act('cursorDown',root);
    expect(moved).toEqual([1,-1]);
});
