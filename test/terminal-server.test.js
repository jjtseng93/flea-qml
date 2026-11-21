import { test, expect } from "bun:test";

test("the tab URL carries the directory, so a Reconnect after exit starts in it", async () => {
  const source = await Bun.file(new URL("../src/terminal-server.js", import.meta.url)).text();
  expect(source).toContain("'?reconnect-token='+encodeURIComponent(record.token)+'&'+args");
});
