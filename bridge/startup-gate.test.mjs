import assert from "node:assert/strict";
import test from "node:test";
import { startBridgeAfterDaemonStartup } from "./startup-gate.mjs";

test("cancellation during daemon startup prevents the bridge from being spawned", async () => {
  const controller = new AbortController();
  let finishDaemonStartup;
  const daemonStartup = new Promise((resolve) => { finishDaemonStartup = resolve; });
  let bridgeStarted = false;

  const startup = startBridgeAfterDaemonStartup({
    signal: controller.signal,
    startDaemon: () => daemonStartup,
    startBridge: () => { bridgeStarted = true; },
  });

  controller.abort();
  finishDaemonStartup();

  assert.equal(await startup, false);
  assert.equal(bridgeStarted, false);
});

test("active daemon startup starts the bridge exactly once", async () => {
  let bridgeStarts = 0;
  const started = await startBridgeAfterDaemonStartup({
    signal: new AbortController().signal,
    startDaemon: async () => {},
    startBridge: () => { bridgeStarts += 1; },
  });

  assert.equal(started, true);
  assert.equal(bridgeStarts, 1);
});
