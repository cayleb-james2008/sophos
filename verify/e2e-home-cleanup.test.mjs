import assert from "node:assert/strict";
import test from "node:test";

let removeTemporaryHomeWithRetry;
try {
  ({ removeTemporaryHomeWithRetry } = await import("./e2e-home-cleanup.mjs"));
} catch (error) {
  if (error?.code !== "ERR_MODULE_NOT_FOUND") throw error;
}

function requireCleanup() {
  assert.equal(typeof removeTemporaryHomeWithRetry, "function", "bounded temporary-HOME cleanup retry is missing");
  return removeTemporaryHomeWithRetry;
}

test("retries transient Windows EBUSY until temporary HOME removal succeeds", async () => {
  let removals = 0;
  const delays = [];
  const result = await requireCleanup()("private-home", {
    maxAttempts: 4,
    retryDelayMs: 75,
    remove() {
      removals += 1;
      if (removals < 3) throw Object.assign(new Error("directory is busy"), { code: "EBUSY" });
    },
    delay: async (ms) => delays.push(ms),
  });

  assert.deepEqual(result, { attempts: 3 });
  assert.equal(removals, 3);
  assert.deepEqual(delays, [75, 75]);
});

test("keeps persistent Windows EBUSY fatal after the configured retry bound", async () => {
  let removals = 0;
  const busy = Object.assign(new Error("directory is busy"), { code: "EBUSY" });

  await assert.rejects(
    requireCleanup()("private-home", {
      maxAttempts: 3,
      retryDelayMs: 1,
      remove() { removals += 1; throw busy; },
      delay: async () => {},
    }),
    (error) => error.code === "EBUSY" && error.cause === busy && /3\/3 attempts/.test(error.message),
  );
  assert.equal(removals, 3);
});

test("does not retry unrelated temporary HOME cleanup failures", async () => {
  let removals = 0;
  const denied = Object.assign(new Error("access denied"), { code: "EACCES" });

  await assert.rejects(
    requireCleanup()("private-home", {
      maxAttempts: 5,
      remove() { removals += 1; throw denied; },
      delay: async () => {},
    }),
    (error) => error.code === "EACCES" && error.cause === denied && /1\/5 attempts/.test(error.message),
  );
  assert.equal(removals, 1);
});
