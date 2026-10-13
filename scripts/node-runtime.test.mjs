import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { validateNodeExecutable } from "./node-runtime.mjs";
import { NODE_RUNTIME_PIN } from "./runtime-pins.mjs";

test("the Windows Node runtime is pinned to an official version and checksum", () => {
  assert.equal(NODE_RUNTIME_PIN.version, "24.18.0");
  assert.equal(NODE_RUNTIME_PIN.platform, "win-x64");
  assert.match(NODE_RUNTIME_PIN.url, /^https:\/\/nodejs\.org\/dist\/v24\.18\.0\/win-x64\/node\.exe$/);
  assert.equal(NODE_RUNTIME_PIN.sha256, "9a4eb5f1c29c6a2e93852ead46b999e284a6a5ca8bab4d4e241d587d025a52de");
});

test("a node.exe that does not match the pinned official checksum is rejected", async () => {
  const root = mkdtempSync(join(tmpdir(), "sophos-node-runtime-test-"));
  const executable = join(root, "node.exe");
  try {
    writeFileSync(executable, "not a Windows Node runtime");
    await assert.rejects(validateNodeExecutable(executable), /SHA-256 mismatch/i);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
