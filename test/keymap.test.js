import { test, expect } from "bun:test";

// flea-qml's own changes to the generated key table (ui/js/Keymap.js), checked in every preset.
const source = (await Bun.file(new URL("../ui/js/Keymap.js", import.meta.url)).text()).replace(/^\.(?:pragma|import).*$/gm, "");
let next = 1000;
const named = { ControlModifier: 0x04000000, AltModifier: 0x08000000, ShiftModifier: 0x02000000, MetaModifier: 0x10000000,
  Key_Return: 16777220, Key_Enter: 16777221, Key_D: 68, Key_I: 73, Key_Equal: 0x3d };
const Qt = new Proxy(named, { get: (t, k) => (k in t ? t[k] : (t[k] = next++)) });
const { lookupFor } = new Function("Qt", source + ";return {lookupFor};")(Qt);
const PRESETS = ["default", "vim", "mac", "windows"];

test("Alt+Enter opens Properties in every preset, as Windows, KDE and GNOME do", () => {
  for (const preset of PRESETS) {
    expect(lookupFor(preset, named.Key_Return, "", named.AltModifier)).toBe("properties");
    expect(lookupFor(preset, named.Key_Enter, "", named.AltModifier)).toBe("properties");
  }
  expect(lookupFor("mac", named.Key_I, "", named.MetaModifier)).toBe("properties");
});

test("= and Alt+= measure folders in every preset; Ctrl+= stays the text size", () => {
  for (const preset of PRESETS) {
    expect(lookupFor(preset, named.Key_Equal, "=", 0)).toBe("measureDirs");
    expect(lookupFor(preset, named.Key_Equal, "", named.AltModifier)).toBe("measureAllDirs");
    expect(lookupFor(preset, named.Key_Equal, "", named.ControlModifier)).toBe("textSizeUp");
  }
});
