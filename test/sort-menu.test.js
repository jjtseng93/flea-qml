import { test, expect } from "bun:test";

// ui/js/Menu.js reads only Sort.ORDERS for the Sort by rows, so the other imports stand in empty.
async function load(name, names, deps = {}) {
  const source = (await Bun.file(new URL("../ui/js/" + name + ".js", import.meta.url)).text()).replace(/^\.(?:pragma|import).*$/gm, "");
  return new Function(...Object.keys(deps), source + ";return {" + names + "};")(...Object.values(deps));
}
const FolderSorts = await load("FolderSorts", "ORDERS");
const Sort = await load("Sort", "ORDERS,choose,column", { DirSizes: {}, FolderSorts, RecentMode: {}, Thumbs: {} });
const Menu = await load("Menu", "sortEntries,sortMenuEntries", { Lists: {}, Archive: {}, ExtThumbs: {}, Format: {}, Sort, StateWords: {} });

test("Sort by offers every order in both directions, lower-case letter ascending and upper-case descending", () => {
  const rows = Menu.sortEntries(false, "name", false);
  expect(rows.map((r) => [r.id, r.keyHint])).toEqual([
    ["name:asc", "n"], ["name:desc", "N"], ["size:asc", "s"], ["size:desc", "S"],
    ["mtime:asc", "t"], ["mtime:desc", "T"], ["kind:asc", "x"], ["kind:desc", "X"],
  ]);
  expect(rows[0].label).toBe("Name, A to Z");
  expect(rows[3].label).toBe("Size, largest first");
  expect(rows[5].label).toBe("Time modified, newest first");
  expect(rows[6].label).toBe("Kind (extension), A to Z");
  // Each letter stands in its own label, so the menu can draw it bold.
  for (const row of rows) expect(row.label.toLowerCase()).toContain(row.keyHint.toLowerCase());
  // The bold letter sits in the order's name, not in a later word that shares the letter.
  expect(rows.map((r) => r.mark)).toEqual(["N", "N", "S", "S", "T", "T", "x", "x"]);
});

test("the order in force carries the check mark, and only it", () => {
  const rows = Menu.sortEntries(false, "size", true);
  expect(rows.filter((r) => r.glyph === "check").map((r) => r.id)).toEqual(["size:desc"]);
});

test("the forget row follows a folder's own sort, after a separator", () => {
  const rows = Menu.sortEntries(true, "name", false);
  expect(rows.slice(-2)).toEqual([{ separator: true }, { id: "__default__", label: "Use the default sort" }]);
});

test("the Grid's Sort menu is one Sort by row holding the same flyout", () => {
  const [row, ...rest] = Menu.sortMenuEntries({ hasFolderSort: false, sortBy: "mtime", sortDesc: false });
  expect(rest).toEqual([]);
  expect(row.action).toBe("sort");
  expect(row.submenu).toEqual(Menu.sortEntries(false, "mtime", false));
});
