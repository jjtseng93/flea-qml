import { test, expect } from "bun:test";
import { shellEnvironment, HOST_ONLY_ENV } from "../src/terminal-server.js";

test("the shells never see the QML host's cache diagnostics", () => {
  const env = shellEnvironment({ HOME: "/h", PATH: "/bin", BUN_JSC_verboseDiskCache: "1", BUNINU_QML_CACHE: "js" });
  expect(env).toEqual({ HOME: "/h", PATH: "/bin" });
  expect(HOST_ONLY_ENV).toEqual(["BUN_JSC_verboseDiskCache", "BUNINU_QML_CACHE"]);
});

test("the tab URL carries the directory, so a Reconnect after exit starts in it", async () => {
  const source = await Bun.file(new URL("../src/terminal-server.js", import.meta.url)).text();
  expect(source).toContain("'?reconnect-token='+encodeURIComponent(record.token)+'&'+args");
});
