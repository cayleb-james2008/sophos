import assert from "node:assert/strict";
import { test } from "node:test";
import { readDaemonKernelState } from "./dist/bridge/src/kernel-state-compat.js";

test("unsupported daemon versions report kernel metadata as unavailable", async () => {
  assert.equal(await readDaemonKernelState({}), undefined);
});

test("supported daemon versions return their actual kernel metadata", async () => {
  const expected = {
    running: true,
    namespace: { names: ["answer"], imports: ["math"] },
    executionCount: 1,
    diagnostic: { reason: "healthy" },
  };
  let calls = 0;
  const connection = {
    async getKernelState() {
      calls += 1;
      assert.equal(this, connection);
      return expected;
    },
  };

  assert.equal(await readDaemonKernelState(connection), expected);
  assert.equal(calls, 1);
});
