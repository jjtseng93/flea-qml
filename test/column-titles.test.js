import { test, expect } from "bun:test";

const source = (await Bun.file(new URL("../ui/js/ColumnTitles.js", import.meta.url)).text()).replace(/^\.pragma.*$/gm, "");
const { TIERS, pick } = new Function(source + ";return { TIERS, pick };")();

test("the titles thin out from Han and English to one letter each, then only the Name remains", () => {
  expect(TIERS.map((tier) => [tier.name, tier.size])).toEqual([
    ["名稱 Name", "大小 Size"], ["名稱", "大小"], ["名N", "大S"], ["名N", ""],
  ]);
});

test("the widest tier that fits is chosen, and the barest when none does", () => {
  const needs = [300, 200, 100, 60];
  expect(pick(needs, 1000)).toBe(0);
  expect(pick(needs, 300)).toBe(0);
  expect(pick(needs, 299)).toBe(1);
  expect(pick(needs, 150)).toBe(2);
  expect(pick(needs, 60)).toBe(3);
  expect(pick(needs, 10)).toBe(3);
});
