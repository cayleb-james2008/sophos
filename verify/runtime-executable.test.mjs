import assert from "node:assert/strict";
import { test } from "node:test";
import { selectE2ENode } from "./runtime-executable.mjs";

test("Windows E2E selects the staged bundled Node runtime", () => {
  assert.equal(
    selectE2ENode("win32", "/host/node", "C:/app/node/node.exe"),
    "C:/app/node/node.exe",
  );
});

test("non-Windows E2E selects the real host Node executable", () => {
  assert.equal(
    selectE2ENode("linux", "/usr/bin/node", "C:/app/node/node.exe"),
    "/usr/bin/node",
  );
});
