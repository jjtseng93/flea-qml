import { test, expect, afterAll } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { grepCommand } from "../src/find.js";
import { matchOf, MATCH_TEXT_LIMIT } from "../src/backend.js";
import { Listing } from "../src/listing.js";

// Ctrl+G's content search: ui/js/Find.js builds grep's arguments and reads its lines, ui/js/Search.js
// opens and turns the mode, and the backend carries each row's matched line as `g`.
async function load(name, names, deps = {}) {
  const s = (await Bun.file(new URL("../ui/js/" + name + ".js", import.meta.url)).text()).replace(/^\.(?:pragma|import).*$/gm, "");
  return new Function(...Object.keys(deps), s + ";return {" + names + "};")(...Object.values(deps));
}
const Find = await load("Find", "grepArguments,grepLine,snippet,CONTEXT,SNIPPET_LIMIT");
const Qt = { Key_Return: 16777220, Key_Enter: 16777221, Key_Escape: 16777216, Key_Backspace: 16777219,
  Key_Tab: 16777217, Key_Backtab: 16777218, Key_G: 71, ControlModifier: 0x04000000, AltModifier: 0x08000000, MetaModifier: 0x10000000 };
const Search = await load("Search", "start,contents,commit,rescope,abort,typeKey,placeholder,sendQuery,TYPING,RESULTS",
  { Qt, Input: { isPasteKey: () => false }, Format: {} });

const root = mkdtempSync(join(tmpdir(), "flea-grep-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

test("grep runs over the scope with the query as literal text, hidden names skipped unless shown", () => {
  const off = Find.grepArguments("a.b*(c)", false);
  expect(off).toEqual(["-r", "-n", "-o", "-a", "-i", "-m", "1", "-Z", "--line-buffered", "-E",
    "--exclude=.*", "--exclude-dir=.*", "-e", ".{0,80}a\\.b\\*\\(c\\).{0,80}"]);
  // No path operand: grep walks "." and the bare "." is never excluded.
  expect(off.some((arg) => arg === "." || arg === "./")).toBe(false);
  expect(Find.grepArguments("x", true)).not.toContain("--exclude=.*");
});

test("a grep line parses into its file, line number and a clean bounded snippet", () => {
  expect(Find.grepLine("dir/a: b.txt\u000012:  let x\t= 1")).toEqual({ path: "dir/a: b.txt", line: 12, text: "let x = 1" });
  // A binary's control bytes become dots; the text is cut at SNIPPET_LIMIT.
  expect(Find.grepLine("bin.dat\u00003:ab\u0000\u0001cd").text).toBe("ab··cd");
  expect(Find.grepLine("long\u00001:" + "y".repeat(5000)).text.length).toBe(Find.SNIPPET_LIMIT);
  for (const junk of ["", "no separator", "\u00001:starts with nul", "a\u0000not a number"]) expect(Find.grepLine(junk)).toBe(null);
});

for (const [label, argv] of [["bunmsh's grep", grepCommand()], ["the system grep", Bun.which("grep") ? [Bun.which("grep")] : null]]) {
  test(`${label} answers the arguments: binary files match, hidden ones follow the setting, long lines stay short`, async () => {
    if (!argv) return;
    const scope = mkdtempSync(join(root, "scope-"));
    mkdirSync(join(scope, "sub"));
    mkdirSync(join(scope, ".hid"));
    writeFileSync(join(scope, "sub", "notes:1.txt"), "first\nSecond Needle here\nneedle again\n");
    writeFileSync(join(scope, "image.bin"), Buffer.from([0, 1, 2, ...Buffer.from("xxNEEDLExx"), 0, 255]));
    writeFileSync(join(scope, "min.js"), "a".repeat(200000) + "needle" + "b".repeat(200000));
    writeFileSync(join(scope, ".hidden.txt"), "needle\n");
    writeFileSync(join(scope, ".hid", "in.txt"), "needle\n");
    writeFileSync(join(scope, "none.txt"), "nothing\n");
    const run = async (hidden) => {
      const child = Bun.spawn([...argv, ...Find.grepArguments("needle", hidden)], { cwd: scope, stdout: "pipe", stderr: "pipe" });
      const out = await new Response(child.stdout).text();
      await child.exited;
      const rows = new Map();
      for (const line of out.split("\n")) {
        if (line.length > 2 * Find.CONTEXT + "needle".length + 400) throw new Error(`an output line of ${line.length} characters`);
        const hit = Find.grepLine(line);
        if (hit && !rows.has(hit.path)) rows.set(hit.path, hit);
      }
      return rows;
    };
    const shown = await run(false);
    expect([...shown.keys()].sort()).toEqual(["image.bin", "min.js", "sub/notes:1.txt"]);
    expect(shown.get("sub/notes:1.txt")).toMatchObject({ line: 2, text: "Second Needle here" });
    expect(shown.get("image.bin").text).toContain("NEEDLE");
    expect(shown.get("min.js").text).toBe("a".repeat(Find.CONTEXT) + "needle" + "b".repeat(Find.CONTEXT));
    expect([...(await run(true)).keys()].sort()).toEqual([".hid/in.txt", ".hidden.txt", "image.bin", "min.js", "sub/notes:1.txt"]);
  }, 30000);
}

test("the backend keeps a checked, bounded match and hands it out as the row's g", () => {
  expect(matchOf({ l: 4, t: "x" })).toEqual({ l: 4, t: "x" });
  expect(matchOf({ l: 2, t: "z".repeat(MATCH_TEXT_LIMIT + 50) }).t.length).toBe(MATCH_TEXT_LIMIT);
  for (const bad of [null, "x", { l: 0, t: "x" }, { l: 1.5, t: "x" }, { l: 3 }]) expect(matchOf(bad)).toBe(null);
  const dir = mkdtempSync(join(root, "rows-"));
  writeFileSync(join(dir, "a.txt"), "x");
  writeFileSync(join(dir, "b.txt"), "x");
  const listing = new Listing(dir, [{ name: "a.txt", dir: false, link: false, match: { l: 3, t: "hit" } }, { name: "b.txt", dir: false, link: false }]);
  const { rows } = listing.window(0, 2);
  expect(rows[0].g).toEqual({ l: 3, t: "hit" });
  expect(rows[1].g).toBeUndefined();
});

// A pane as Search.js reads it, recording what it asks the backend.
function pane(extra = {}) {
  const calls = [];
  const root = {
    calls, recentMode: "", searchMode: "", searchQuery: "", searchSent: "", searchGen: 0, searchStep: 0,
    path: "/work", home: "/home/u", showHidden: false, windowSize: 40, sizeWish: false, cursorIndex: 0,
    rowFor: () => null, join: (a, b) => a + "/" + b,
    backend: {
      searchOpen: (scope, folder, hidden) => calls.push(["open", scope]),
      searchQuery: (query, gen, count, sizes, contents) => calls.push(["query", query, contents]),
      searchCancel: () => calls.push(["cancel"]), searchClose: () => calls.push(["close"]),
    },
    openWithoutHistory: (path) => calls.push(["relist", path]),
    ...extra,
  };
  return root;
}
const key = (code, modifiers = 0) => ({ key: code, modifiers, text: "" });

test("Ctrl+G opens a content search that waits for Enter, as f opens a name search", () => {
  const root = pane();
  Search.contents(root);
  expect(root.searchMode).toBe(Search.TYPING);
  expect(root.searchContents).toBe(true);
  expect(root.calls).toEqual([["open", "/work"]]);
  expect(Search.placeholder(root.path, root.home, root.searchStep, true)).toBe("grep -ri ");
  root.searchQuery = "needle";
  Search.typeKey(key(Qt.Key_Return), root);
  expect(root.calls.at(-1)).toEqual(["query", "needle", true]);
  expect(root.searchMode).toBe(Search.RESULTS);
  // f starts a name search afresh.
  const named = pane();
  Search.start(named);
  expect(named.searchContents).toBe(false);
  expect(Search.placeholder(named.path, named.home, 0, false)).toBe("find . -iname ");
});

test("Ctrl+G inside Find only turns the mode; the query runs at the next Enter", () => {
  const root = pane();
  Search.start(root);
  root.searchQuery = "draft";
  Search.typeKey(key(Qt.Key_G, Qt.ControlModifier), root);
  expect(root.searchContents).toBe(true);
  expect(root.calls.filter((c) => c[0] === "query")).toEqual([]);
  Search.typeKey(key(Qt.Key_Return), root);
  expect(root.calls.at(-1)).toEqual(["query", "draft", true]);
  expect(root.searchMode).toBe(Search.RESULTS);
  // From the results (a query already run) it still waits, back on the query line.
  const sent = root.calls.length;
  Search.contents(root);
  expect(root.searchContents).toBe(false);
  expect(root.searchMode).toBe(Search.TYPING);
  expect(root.calls.length).toBe(sent);
  root.searchEnterAt = 0;
  Search.typeKey(key(Qt.Key_Return), root);
  expect(root.calls.at(-1)).toEqual(["query", "draft", false]);
});

test("Tab, Enter and Esc keep their meanings in a content search", () => {
  const root = pane();
  Search.contents(root);
  root.searchQuery = "needle";
  Search.typeKey(key(Qt.Key_Return), root);
  // Tab turns the scope and reruns, still over contents.
  Search.typeKey(key(Qt.Key_Tab), root);
  expect(root.calls.slice(-2)).toEqual([["open", "/home/u"], ["query", "needle", true]]);
  // Esc while the walk runs stops it and keeps the results; the next Esc leaves.
  root.searchRunning = true;
  Search.typeKey(key(Qt.Key_Escape), root);
  expect(root.calls.at(-1)).toEqual(["cancel"]);
  expect(root.searchMode).not.toBe("");
  root.searchRunning = false;
  Search.typeKey(key(Qt.Key_Escape), root);
  expect(root.calls.slice(-2)).toEqual([["close"], ["relist", "/work"]]);
});
