import assert from "node:assert/strict";
import test from "node:test";
import { runRecoveryProbe } from "./recovery-probe.mjs";

const fixture = { provider: "sophos-e2e-mock", model: "sophos-e2e-model" };
const text = "recovery persistence probe";

test("missing fixture model configuration fails closed before any RPC", async () => {
  const calls = [];
  const result = await runRecoveryProbe({
    send: async (request) => { calls.push(request); },
    provider: undefined,
    model: fixture.model,
    text,
  });

  assert.equal(result.modelSelected, false);
  assert.equal(result.selectionFailure, "missing-fixture-model");
  assert.deepEqual(calls, []);
});

test("setModel JSON-RPC errors fail closed without dispatching the recovery prompt", async () => {
  const calls = [];
  const result = await runRecoveryProbe({
    send: async (request) => {
      calls.push(request);
      return { error: { code: -32603, message: "model unavailable" } };
    },
    ...fixture,
    text,
  });

  assert.equal(result.modelSelected, false);
  assert.equal(result.selectionFailure, "set-model-error");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, "setModel");
});

test("setModel transport failures fail closed without dispatching the recovery prompt", async () => {
  const calls = [];
  const result = await runRecoveryProbe({
    send: async (request) => {
      calls.push(request);
      throw new Error("setModel transport failed");
    },
    ...fixture,
    text,
  });

  assert.equal(result.modelSelected, false);
  assert.equal(result.selectionFailure, "set-model-transport-error");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, "setModel");
});

test("recovery prompt is dispatched only after the exact fixture model is selected", async () => {
  const calls = [];
  const result = await runRecoveryProbe({
    send: async (request) => {
      calls.push(request);
      if (request.method === "setModel") {
        return { result: { provider: fixture.provider, model: fixture.model } };
      }
      return { result: { accepted: true } };
    },
    ...fixture,
    text,
  });

  assert.equal(result.modelSelected, true);
  assert.deepEqual(calls.map((request) => request.method), ["setModel", "prompt"]);
  assert.deepEqual(calls[1].params, { text });
  assert.deepEqual(result.promptResponse, { result: { accepted: true } });
});
