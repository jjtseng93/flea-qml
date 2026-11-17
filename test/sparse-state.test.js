import { test, expect } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import vm from "node:vm";
import { defaults, overrides, fromFile, isUiDocument, patched } from "../src/uistate.js";
import { updateState, readState } from "../src/uistore.js";

test("QML default expansion matches backend and preserves explicit false and empty arrays", () => {
  const ctx = vm.createContext({});
  vm.runInContext(readFileSync(new URL("../ui/js/UiDefaults.js", import.meta.url), "utf8").replace(/^\.pragma.*$/gm, ""), ctx);
  expect(JSON.parse(JSON.stringify(ctx.state))).toEqual(defaults());
  ctx.UiDefaults = {state: ctx.state};
  vm.runInContext(readFileSync(new URL("../ui/js/UiState.js", import.meta.url), "utf8").replace(/^\.(?:pragma|import).*$/gm, ""), ctx);
  expect(JSON.parse(JSON.stringify(ctx.fromFile('{}').state))).toEqual(defaults());
  const result = ctx.fromFile('{"places":{"showHome":false},"menu":{"hidden":[]}}').state;
  expect(result.places.showHome).toBe(false);
  expect(result.places.sidebarWidth).toBe(160);
  expect(result.menu.hidden).toEqual([]);
  expect(ctx.fromFile('{"keyHints":false}').state.keyHints).toBe(true);
});

test("writes only deviations, restores defaults, merges concurrent patches, preserves unknowns", () => {
  const dir = mkdtempSync(join(tmpdir(), "flea-sparse-"));
  const paths = {file: join(dir,"ui.json"), lock: join(dir,"lock"), legacy: join(dir,"view.json")};
  const disk = () => JSON.parse(readFileSync(paths.file,"utf8"));
  try {
    updateState({places:{sidebarWidth:224}},paths);
    expect(disk()).toEqual({stateVersion:defaults().stateVersion,places:{sidebarWidth:224}});
    updateState({hidden:true},paths);
    expect(readState(paths).places.sidebarWidth).toBe(224);
    updateState({places:{sidebarWidth:160}},paths);
    expect(disk().places).toBeUndefined();
    expect(disk().hidden).toBe(true);
    updateState({hidden:false},paths);
    expect(isUiDocument(disk())).toBe(true);
    expect(readState(paths)).toEqual(defaults());
    writeFileSync(paths.file,JSON.stringify({...defaults(), customFuture:{value:42}}));
    updateState({},paths);
    expect(disk()).toEqual({stateVersion:defaults().stateVersion,customFuture:{value:42}});
    expect(fromFile(JSON.stringify(overrides(defaults())))).toEqual(defaults());
  } finally { rmSync(dir,{recursive:true,force:true}); }
});

test("unspecified values follow future defaults while explicit overrides remain", () => {
  const base = defaults();
  const state = {...base, hidden:true};
  const saved = overrides(state);
  const future = {...base, density:"comfortable"};
  expect({...future, ...saved}.density).toBe("comfortable");
  expect({...future, ...saved}.hidden).toBe(true);
  expect(overrides({...base, places:{...base.places, sidebarWidth:192}}).places.sidebarWidth).toBe(192);
});

test("keyboard hints cannot be disabled by legacy state or a new patch", () => {
  expect(fromFile('{"keyHints":false}').keyHints).toBe(true);
  const state = patched(defaults(), {keyHints:false});
  expect(state.keyHints).toBe(true);
  expect(overrides(state).keyHints).toBeUndefined();
});
