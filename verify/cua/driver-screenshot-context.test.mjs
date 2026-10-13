import assert from "node:assert/strict";
import { test } from "node:test";
import * as driver from "./driver.mjs";

test("pixel-click state capture requests screenshot context for the same window", () => {
  assert.equal(typeof driver.getWindowStateForPixelClick, "function");

  const pid = 4242;
  const windowId = 8675309;
  const response = { pid, window_id: windowId, screenshot_width: 1280, screenshot_height: 720 };
  const calls = [];
  const state = driver.getWindowStateForPixelClick(pid, windowId, (tool, args) => {
    calls.push({ tool, args });
    return response;
  });

  assert.equal(state, response);
  assert.deepEqual(calls, [
    {
      tool: "get_window_state",
      args: { pid, window_id: windowId, include_screenshot: true, session: driver.CUA_SESSION },
    },
  ]);
});
