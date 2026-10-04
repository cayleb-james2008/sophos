import assert from "node:assert/strict";
import { test } from "node:test";
import { parseBridgeVerifyResult } from "./e2e-result.mjs";

test("accepts a real bridge verifier only when every check passed and exit is zero", () => {
  assert.deepEqual(
    parseBridgeVerifyResult(0, "PASS result\n=== 30/30 checks passed ===\n"),
    { passed: 30, total: 30, ok: true },
  );
});

test("rejects partial checks even when the verifier exits zero", () => {
  assert.deepEqual(
    parseBridgeVerifyResult(0, "=== 29/30 checks passed ===\n"),
    { passed: 29, total: 30, ok: false },
  );
});

test("rejects missing summaries and nonzero process exits", () => {
  assert.deepEqual(parseBridgeVerifyResult(0, "no summary"), { passed: 0, total: 0, ok: false });
  assert.deepEqual(parseBridgeVerifyResult(1, "=== 30/30 checks passed ==="), { passed: 30, total: 30, ok: false });
});
