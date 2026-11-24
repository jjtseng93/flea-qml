import {test, expect} from 'bun:test';
import {defaults, patched, overrides, fromFile} from '../src/uistate.js';

test('Windows paths survive settings validation and disk round trips', () => {
  for (const path of ['C:\\Users\\wxk', 'C:/Users/wxk', 'D:\\', '\\\\server\\share\\資料夾']) {
    const patch = {lastPath:path, lastTabs:{paths:[path],index:0}, dual:{paths:[path,path],focus:0,split:5000},
      folderSorts:{[path]:{key:'name',reverse:false}}, folderViews:{[path]:'list'}};
    const state = patched(defaults(), patch);
    const restored = fromFile(JSON.stringify(overrides(state)));
    for (const key of Object.keys(patch)) expect(restored[key]).toEqual(patch[key]);
  }
});

test('drive-relative and ordinary relative paths remain invalid', () => {
  for (const path of ['C:Users', 'Users/wxk', './folder']) {
    expect(() => patched(defaults(), {lastPath:path})).toThrow();
    expect(() => patched(defaults(), {lastTabs:{paths:[path],index:0}})).toThrow();
  }
});
