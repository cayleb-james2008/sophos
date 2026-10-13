import assert from "node:assert/strict";
import { test } from "node:test";

const { invokeWithForegroundFallback } = await import("./driver.mjs");

test("retries exactly the refused action in foreground on the CUA structured signal", () => {
  const calls = [];
  const invoke = (tool, args) => {
    calls.push({ tool, args });
    if (!args.delivery_mode) {
      throw new Error(
        'cua-driver call hotkey exited 1: {"code":"background_unavailable","suggestion":"Retry with foreground"}',
      );
    }
    return { ok: true };
  };

  assert.deepEqual(invokeWithForegroundFallback(invoke, "hotkey", { pid: 12, keys: ["ctrl", "k"] }), { ok: true });
  assert.deepEqual(calls, [
    { tool: "hotkey", args: { pid: 12, keys: ["ctrl", "k"] } },
    { tool: "hotkey", args: { pid: 12, keys: ["ctrl", "k"], delivery_mode: "foreground" } },
  ]);
});

test("recognizes the upstream structuredContent refusal shape", () => {
  const calls = [];
  const invoke = (tool, args) => {
    calls.push({ tool, args });
    if (!args.delivery_mode) {
      throw new Error('cua-driver call click exited 1: {"isError":true,"structuredContent":{"code":"background_unavailable"}}');
    }
    return { ok: true };
  };

  assert.deepEqual(invokeWithForegroundFallback(invoke, "click", { pid: 12, x: 5, y: 6 }), { ok: true });
  assert.equal(calls.length, 2);
  assert.equal(calls[1].args.delivery_mode, "foreground");
});

test("does not retry unrelated CUA refusals such as stale element tokens", () => {
  const stale = new Error('cua-driver call click exited 1: {"refusal":{"code":"stale_element_token"}}');
  const calls = [];
  const invoke = (tool, args) => {
    calls.push({ tool, args });
    throw stale;
  };

  assert.throws(() => invokeWithForegroundFallback(invoke, "click", { pid: 12, element_token: "old" }), (err) => err === stale);
  assert.equal(calls.length, 1);
});
