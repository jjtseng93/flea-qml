import { test, expect } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, chmodSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describeKind } from "../src/kinds.js";
import { Listing } from "../src/listing.js";

const kindOf = (name, mode = 0o100644) => describeKind(name, false, mode, null).kind;

test("a Kind is its category and its upper-case extension", () => {
  expect(kindOf("a.jpg")).toBe("Image JPG");
  expect(kindOf("a.jpeg")).toBe("Image JPEG");
  expect(kindOf("a.png")).toBe("Image PNG");
  expect(kindOf("a.pdf")).toBe("Document PDF");
  expect(kindOf("a.md")).toBe("Document MD");
  expect(kindOf("a.js")).toBe("Code JS");
  expect(kindOf("Dockerfile")).toBe("Code DOCKERFILE");
  expect(kindOf("a.xyz")).toBe("File XYZ");
  expect(kindOf("README")).toBe("File");
  expect(kindOf("run", 0o100755)).toBe("Program");
  expect(describeKind("photos", true, 0o40755, null).kind).toBe("Folder");
});

test("the Kind order compares exactly the Kind each row shows", () => {
  const dir = mkdtempSync(join(tmpdir(), "flea-kind-"));
  try {
    const names = ["z.png", "a.mp4", "b.jpg", "c.pdf", "d.md", "e.js", "f.xyz", "run", "g.jpeg"];
    for (const name of names) writeFileSync(join(dir, name), "x");
    chmodSync(join(dir, "run"), 0o755);
    mkdirSync(join(dir, "sub"));
    const listing = new Listing(dir, [...names, "sub"].map((name) => ({ name, dir: name === "sub", link: false })));
    const shown = (desc) => {
      listing.sort({ by: "kind", desc, foldersFirst: true });
      return listing.window(0, 20).rows.map((row) => [row.n, listing.window(0, 20).kinds[row.k]]);
    };
    const ascending = shown(false);
    // Folders first, then the shown Kind text in order, ties by name.
    expect(ascending.map(([, kind]) => kind)).toEqual(["Folder", "Code JS", "Document MD", "Document PDF",
      "File XYZ", "Image JPEG", "Image JPG", "Image PNG", "Program", "Video MP4"]);
    const descending = shown(true);
    expect(descending[0]).toEqual(["sub", "Folder"]);
    expect(descending.slice(1).map(([, kind]) => kind)).toEqual(ascending.slice(1).map(([, kind]) => kind).reverse());
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
