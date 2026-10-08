import assert from "node:assert/strict";
import { test } from "node:test";

import * as findUtil from "./find-util.mjs";

const requiredNav = ["Chat", "Sessions", "Agents", "Inbox", "Settings"].map((name) => ({
  role: "Button",
  name,
}));

const makeState = (names) => ({
  pid: 17,
  window_id: 23,
  elements: names.map((label) => ({ role: "Button", label })),
});

test("UIA readiness waits for every required nav button after a partial first snapshot", async () => {
  const snapshots = [
    makeState(["Sessions", "Agents", "Inbox", "Settings"]),
    makeState(["Chat", "Sessions", "Agents", "Inbox", "Settings"]),
  ];
  let reads = 0;
  let now = 0;
  const readBudgets = [];
  const waitForAllElements = findUtil.waitForAllElements;
  assert.equal(typeof waitForAllElements, "function", "missing all-elements readiness poll");

  const ready = await waitForAllElements(
    (remainingMs) => {
      readBudgets.push(remainingMs);
      now += 10;
      return snapshots[Math.min(reads++, snapshots.length - 1)];
    },
    requiredNav,
    3000,
    { sleepFn: async (ms) => { now += ms; }, nowFn: () => now },
  );

  assert.deepEqual(ready, snapshots[1]);
  assert.equal(reads, 2);
  assert.deepEqual(readBudgets, [3000, 2740]);
});

test("UIA readiness fails closed when one required nav button never appears", async () => {
  const partial = makeState(["Chat", "Sessions", "Agents", "Inbox"]);
  let reads = 0;
  let now = 0;
  const waitForAllElements = findUtil.waitForAllElements;
  assert.equal(typeof waitForAllElements, "function", "missing all-elements readiness poll");

  const ready = await waitForAllElements(
    () => {
      reads += 1;
      return partial;
    },
    requiredNav,
    300,
    { sleepFn: async (ms) => { now += ms; }, nowFn: () => now },
  );

  assert.equal(ready, null, "the poll must not treat a partial nav tree as ready");
  assert.equal(reads, 2, "the poll should not start a CUA read after the deadline");
});

test("UIA readiness rejects a complete snapshot that arrives after the deadline", async () => {
  const complete = makeState(["Chat", "Sessions", "Agents", "Inbox", "Settings"]);
  let now = 0;

  const ready = await findUtil.waitForAllElements(
    () => {
      now = 301;
      return complete;
    },
    requiredNav,
    300,
    { sleepFn: async () => {}, nowFn: () => now },
  );

  assert.equal(ready, null, "a slow read must not satisfy readiness after its deadline");
});

test("UIA readiness rejects a non-finite timeout before polling", async () => {
  const partial = makeState(["Sessions"]);

  await assert.rejects(
    findUtil.waitForAllElements(
      () => partial,
      requiredNav,
      Number.NaN,
      { sleepFn: async () => { throw new Error("polling started"); } },
    ),
    { name: "RangeError", message: "timeoutMs must be a finite nonnegative number" },
  );
});
