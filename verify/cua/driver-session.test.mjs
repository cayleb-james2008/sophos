import assert from "node:assert/strict";
import { test } from "node:test";

const { DRIVER_SESSION, withSession, createSessionInvoker } = await import("./driver.mjs");

test("one-shot state reads and pixel actions share a named CUA session", () => {
  assert.equal(typeof withSession, "function");
  assert.equal(typeof DRIVER_SESSION, "string");
  assert.ok(DRIVER_SESSION.length > 0);

  const read = withSession({ pid: 12, window_id: 34 });
  const click = withSession({ pid: 12, window_id: 34, x: 50, y: 60 });
  assert.equal(read.session, DRIVER_SESSION);
  assert.equal(click.session, read.session);
});

test("an explicit CUA session label is preserved", () => {
  const input = { pid: 12, window_id: 34, session: "smoke-regression" };
  assert.deepEqual(withSession(input), input);
});

test("one-shot CUA calls open once and reuse their session snapshot", () => {
  const observed = [];
  const runTool = (tool, args) => {
    observed.push({ tool, args });
    return { ok: true };
  };
  const invoke = createSessionInvoker(runTool, "smoke-lifecycle");

  invoke("get_window_state", { pid: 12, window_id: 34 });
  invoke("click", { pid: 12, window_id: 34, x: 50, y: 60 });

  assert.deepEqual(observed, [
    { tool: "start_session", args: { session: "smoke-lifecycle" } },
    {
      tool: "get_window_state",
      args: { pid: 12, window_id: 34, session: "smoke-lifecycle" },
    },
    {
      tool: "click",
      args: { pid: 12, window_id: 34, x: 50, y: 60, session: "smoke-lifecycle" },
    },
  ]);

  invoke("end_session", {});
  assert.deepEqual(observed.at(-1), {
    tool: "end_session",
    args: { session: "smoke-lifecycle" },
  });
});
