import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import test from "node:test";
import { join, win32 } from "node:path";

import * as driver from "./driver.mjs";
import * as launch from "./launch.mjs";

test("uses the explicit CUA_DRIVER_BIN override verbatim", () => {
  const configured = String.raw`D:\Tools\Cua\cua-driver.exe`;
  assert.equal(
    driver.resolveDriverBin({
      platform: "win32",
      env: { CUA_DRIVER_BIN: configured, LOCALAPPDATA: String.raw`C:\Users\runneradmin\AppData\Local` },
      homeDir: String.raw`C:\Users\runneradmin`,
    }),
    configured,
  );
});

test("derives the Windows binary path from the current user's LOCALAPPDATA", () => {
  const localAppData = String.raw`C:\Users\runneradmin\AppData\Local`;
  assert.equal(
    driver.resolveDriverBin({
      platform: "win32",
      env: { LOCALAPPDATA: localAppData },
      homeDir: String.raw`C:\Users\runneradmin`,
    }),
    win32.join(localAppData, "Programs", "Cua", "cua-driver", "bin", "cua-driver.exe"),
  );
});

test("falls back to AppData under the current Windows home when LOCALAPPDATA is absent", () => {
  const homeDir = String.raw`C:\Users\cayleb`;
  assert.equal(
    driver.resolveDriverBin({ platform: "win32", env: {}, homeDir }),
    win32.join(homeDir, "AppData", "Local", "Programs", "Cua", "cua-driver", "bin", "cua-driver.exe"),
  );
});

test("uses the PATH-resolvable command outside Windows when no override is provided", () => {
  assert.equal(driver.resolveDriverBin({ platform: "linux", env: {}, homeDir: "/home/cayleb" }), "cua-driver");
});

test("does not treat a same-named cwd file as a PATH-resolvable CUA binary", () => {
  const cwd = mkdtempSync(join(tmpdir(), "cua-driver-path-"));
  try {
    writeFileSync(join(cwd, "cua-driver"), "not a runnable binary");
    const driverUrl = new URL("./driver.mjs", import.meta.url).href;
    const script = `import { isDriverInstalled } from ${JSON.stringify(driverUrl)}; console.log(isDriverInstalled());`;
    const env = Object.fromEntries(
      Object.entries(process.env).filter(([key]) => key.toLowerCase() !== "path" && key !== "CUA_DRIVER_BIN"),
    );
    env.PATH = "";
    env.CUA_DRIVER_BIN = "cua-driver";
    const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
      encoding: "utf-8",
      cwd,
      env,
      windowsHide: true,
    });

    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), "false");
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("fails closed when the bare-command version probe times out", { skip: process.platform === "win32" ? "requires a POSIX executable fixture" : false }, () => {
  const cwd = mkdtempSync(join(tmpdir(), "cua-driver-timeout-"));
  try {
    writeFileSync(join(cwd, "cua-driver"), "#!/bin/sh\nexec /bin/sleep 30\n", { mode: 0o755 });
    const driverUrl = new URL("./driver.mjs", import.meta.url).href;
    const script = `import { isDriverInstalled } from ${JSON.stringify(driverUrl)}; console.log(isDriverInstalled());`;
    const env = Object.fromEntries(
      Object.entries(process.env).filter(([key]) => key.toLowerCase() !== "path" && key !== "CUA_DRIVER_BIN"),
    );
    env.PATH = cwd;
    env.CUA_DRIVER_BIN = "cua-driver";
    const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
      encoding: "utf-8",
      cwd,
      env,
      windowsHide: true,
      timeout: 8000,
    });

    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), "false");
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("recognizes an explicitly configured executable as installed", () => {
  const driverUrl = new URL("./driver.mjs", import.meta.url).href;
  const script = `import { isDriverInstalled } from ${JSON.stringify(driverUrl)}; console.log(isDriverInstalled());`;
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
    encoding: "utf-8",
    env: { ...process.env, CUA_DRIVER_BIN: process.execPath },
    windowsHide: true,
  });

  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), "true");
});

test("pixel clicks acquire screenshot context and reuse one session label", () => {
  assert.equal(typeof driver.CUA_SESSION, "string");
  assert.equal(typeof driver.clickWithScreenshotContext, "function");
  const calls = [];
  const invoke = (tool, args) => {
    calls.push({ tool, args });
    return {};
  };
  const session = `${driver.CUA_SESSION}-pixel-click-regression`;
  const pid = 930001;
  const windowId = 930002;

  driver.getWindowState(pid, windowId, { include_screenshot: false, session }, invoke);
  calls.length = 0;
  const screenshotPath = join(tmpdir(), "cua-click-context-regression.png");
  driver.clickWithScreenshotContext(pid, 123, 456, windowId, session, invoke, screenshotPath);

  assert.deepEqual(calls, [
    {
      tool: "get_window_state",
      args: { pid, window_id: windowId, include_screenshot: true, screenshot_out_file: screenshotPath, session },
    },
    {
      tool: "click",
      args: { pid, x: 123, y: 456, window_id: windowId, session },
    },
  ]);
});

test("pixel clicks never assume an implicit screenshot default", () => {
  const calls = [];
  const invoke = (tool, args) => {
    calls.push({ tool, args });
    return {};
  };
  const session = `${driver.CUA_SESSION}-implicit-screenshot-regression`;
  const pid = 930011;
  const windowId = 930012;
  driver.getWindowState(pid, windowId, { session }, invoke);
  calls.length = 0;
  const screenshotPath = join(tmpdir(), "cua-unknown-default.png");
  driver.clickWithScreenshotContext(pid, 10, 20, windowId, session, invoke, screenshotPath);
  assert.deepEqual(calls.map(({ tool }) => tool), ["get_window_state", "click"]);
  assert.equal(calls[0].args.include_screenshot, true);
  assert.equal(calls[0].args.session, session);
  assert.equal(calls[0].args.screenshot_out_file, screenshotPath);
});

test("one-shot input actions carry a stable session and refresh stale click context", () => {
  assert.equal(typeof driver.sessionScopedPayload, "function");
  const session = `${driver.CUA_SESSION}-action-regression`;
  const calls = [];
  const invoke = (_binary, argv, options) => {
    calls.push({ tool: argv[1], args: JSON.parse(options.input) });
    return { status: 0, stdout: "{}", stderr: "" };
  };
  const actions = [
    ["get_window_state", { pid: 940001, window_id: 940002, include_screenshot: true }],
    ["click", { pid: 940001, window_id: 940002, x: 1, y: 2 }],
    ["type_text", { pid: 940001, window_id: 940002, text: "draft", element_token: "snapshot-token" }],
    ["press_key", { pid: 940001, window_id: 940002, key: "enter" }],
    ["hotkey", { pid: 940001, window_id: 940002, keys: ["ctrl", "a"] }],
    ["scroll", { pid: 940001, window_id: 940002, direction: "down", amount: 2 }],
    ["bring_to_front", { pid: 940001, window_id: 940002 }],
  ];

  for (const [tool, args] of actions) {
    driver.call(tool, { ...args, session }, invoke);
  }
  for (const { args } of calls) assert.equal(args.session, session);

  const listWindowsCall = driver.call("list_windows", {}, invoke);
  assert.equal(calls.at(-1).args.session, driver.CUA_SESSION, "all v0.33.4 tool calls share the default run session");
  assert.deepEqual(listWindowsCall, {});

  const pid = 940011;
  const windowId = 940012;
  driver.getWindowState(pid, windowId, { include_screenshot: true, session }, (_tool, _args) => ({}));
  driver.call("type_text", { pid, window_id: windowId, text: "update", session }, invoke);
  calls.length = 0;
  const screenshotPath = join(tmpdir(), "cua-after-input-regression.png");
  driver.clickWithScreenshotContext(pid, 10, 20, windowId, session, (_tool, args) => {
    calls.push({ tool: _tool, args });
    return {};
  }, screenshotPath);
  assert.deepEqual(calls.map(({ tool }) => tool), ["get_window_state", "click"]);
  assert.equal(calls[0].args.session, session);
  assert.equal(calls[0].args.include_screenshot, true);
  assert.equal(calls[0].args.screenshot_out_file, screenshotPath);
  assert.equal(calls[1].args.session, session);
});

test("resolves release and debug app paths under the supplied workspace", () => {
  assert.equal(typeof launch.resolveAppBuildPath, "function");
  const workspace = join(tmpdir(), "sophos-cua-workspace-fixture");
  assert.equal(
    launch.resolveAppBuildPath(workspace, "release"),
    join(workspace, "src-tauri", "target", "release", "prime-agent-windows.exe"),
  );
  assert.equal(
    launch.resolveAppBuildPath(workspace, "debug"),
    join(workspace, "src-tauri", "target", "debug", "prime-agent-windows.exe"),
  );
});

test("startDaemon clears the context cache before any already-running early return", () => {
  const source = readFileSync(new URL("./driver.mjs", import.meta.url), "utf8");
  const start = source.indexOf("export function startDaemon()");
  const end = source.indexOf("export function stopDaemon()", start);
  assert.ok(start >= 0 && end > start, "the daemon start function must remain present");
  const body = source.slice(start, end);
  assert.match(body, /screenshotContexts\.clear\(\)/);
  assert.ok(
    body.indexOf("screenshotContexts.clear()") < body.indexOf("return { alreadyRunning: true };"),
    "cached screenshot context must not survive a daemon that was restarted externally",
  );
});

test("stopping the CUA daemon invalidates cached screenshot context", () => {
  const source = readFileSync(new URL("./driver.mjs", import.meta.url), "utf8");
  const start = source.indexOf("export function stopDaemon()");
  const end = source.indexOf("export function listWindows", start);
  assert.ok(start >= 0 && end > start, "the daemon stop function must remain present");
  assert.match(source.slice(start, end), /screenshotContexts\.clear\(\)/);
});

test("pixel clicks fail closed without a window ID for screenshot context", () => {
  const calls = [];
  assert.throws(
    () => driver.clickWithScreenshotContext(950001, 10, 20, undefined, "missing-window-context", (tool, args) => {
      calls.push({ tool, args });
    }),
    /windowId/i,
  );
  assert.deepEqual(calls, [], "no coordinate click may be sent without a screenshot-addressable window");
});

function runIsolatedCuaScript(script) {
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
    encoding: "utf-8",
    env: { ...process.env, CUA_DRIVER_BIN: "__pr11_test_stub_never_execute__" },
    windowsHide: true,
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout.trim());
}

test("applies an opt-in timeout to CUA driver calls and leaves normal calls unchanged", () => {
  const driverUrl = new URL("./driver.mjs", import.meta.url).href;
  const output = runIsolatedCuaScript(`
    process.env.CUA_DRIVER_COMMAND_TIMEOUT_MS = "37000";
    const driver = await import(${JSON.stringify(driverUrl)});
    const timeouts = [];
    const invoke = (_binary, _argv, options) => {
      timeouts.push(options.timeout ?? null);
      return { status: 0, stdout: "{}", stderr: "" };
    };
    driver.call("list_windows", {}, invoke);
    delete process.env.CUA_DRIVER_COMMAND_TIMEOUT_MS;
    driver.call("list_windows", {}, invoke);
    console.log(JSON.stringify(timeouts));
  `);
  assert.deepEqual(output, [37000, null]);
});

test("hotkey fallback retries once with foreground only on structured background refusal", () => {
  const driverUrl = new URL("./driver.mjs", import.meta.url).href;
  const output = runIsolatedCuaScript(`
    import childProcess from "node:child_process";
    import { syncBuiltinESMExports } from "node:module";
    const calls = [];
    childProcess.spawnSync = (_binary, argv, options) => {
      const args = JSON.parse(options.input);
      calls.push({ tool: argv[1], args });
      if (calls.length === 1) {
        return { status: 1, stdout: "", stderr: JSON.stringify({ code: "background_unavailable" }) };
      }
      return { status: 0, stdout: JSON.stringify({ accepted: true }), stderr: "" };
    };
    syncBuiltinESMExports();
    const driver = await import(${JSON.stringify(driverUrl)});
    try {
      const value = driver.callWithForegroundFallback("hotkey", { pid: 930101, keys: ["alt", "enter"] });
      console.log(JSON.stringify({ value, calls }));
    } catch (error) {
      console.log(JSON.stringify({ error: error.message, calls }));
    }
  `);

  assert.equal(output.error, undefined, JSON.stringify(output.error));
  assert.deepEqual(output.value, { accepted: true });
  assert.equal(output.calls.length, 2);
  assert.equal(output.calls[0].args.delivery_mode, undefined);
  assert.equal(output.calls[1].args.delivery_mode, "foreground");
});

test("foreground scroll brings the exact window forward before sending the wheel", () => {
  const driverUrl = new URL("./driver.mjs", import.meta.url).href;
  const output = runIsolatedCuaScript(`
    import childProcess from "node:child_process";
    import { syncBuiltinESMExports } from "node:module";
    const calls = [];
    childProcess.spawnSync = (_binary, argv, options) => {
      const tool = argv[1];
      const args = JSON.parse(options.input);
      calls.push({ tool, args });
      if (tool === "bring_to_front") {
        return {
          status: 0,
          stdout: JSON.stringify({ landed_on_target: true, target_hwnd: "0x1234", now_fg_hwnd: "0x1234" }),
          stderr: "",
        };
      }
      if (tool === "scroll") {
        return {
          status: 0,
          stdout: JSON.stringify({ delivery: { mode: "foreground" }, effect: "unverifiable", route: "global_input" }),
          stderr: "",
        };
      }
      return { status: 1, stdout: "", stderr: JSON.stringify({ code: "unexpected_call" }) };
    };
    syncBuiltinESMExports();
    const driver = await import(${JSON.stringify(driverUrl)});
    try {
      const value = await driver.scrollAfterBringToFront(930201, "down", 5, 930202, { x: 914, y: 764, settleMs: 0 });
      console.log(JSON.stringify({ value, calls }));
    } catch (error) {
      console.log(JSON.stringify({ error: error.message, calls }));
    }
  `);

  assert.equal(output.error, undefined, JSON.stringify(output.error));
  assert.deepEqual(output.calls.map(({ tool }) => tool), ["bring_to_front", "scroll"]);
  assert.equal(output.calls[0].args.pid, 930201);
  assert.equal(output.calls[0].args.window_id, 930202);
  assert.equal(typeof output.calls[0].args.session, "string");
  assert.equal(output.calls[1].args.pid, 930201);
  assert.equal(output.calls[1].args.window_id, 930202);
  assert.equal(output.calls[1].args.direction, "down");
  assert.equal(output.calls[1].args.amount, 5);
  assert.equal(output.calls[1].args.x, 914);
  assert.equal(output.calls[1].args.y, 764);
  assert.equal(output.calls[1].args.delivery_mode, "foreground");
  assert.equal(output.value.activation.landed_on_target, true);
  assert.equal(output.value.result.route, "global_input");
});

test("foreground scroll refuses global input when target activation is not confirmed", () => {
  const driverUrl = new URL("./driver.mjs", import.meta.url).href;
  const output = runIsolatedCuaScript(`
    import childProcess from "node:child_process";
    import { syncBuiltinESMExports } from "node:module";
    const calls = [];
    childProcess.spawnSync = (_binary, argv, options) => {
      const tool = argv[1];
      const args = JSON.parse(options.input);
      calls.push({ tool, args });
      if (tool === "bring_to_front") {
        return { status: 0, stdout: JSON.stringify({ landed_on_target: false }), stderr: "" };
      }
      return { status: 0, stdout: JSON.stringify({ route: "global_input" }), stderr: "" };
    };
    syncBuiltinESMExports();
    const driver = await import(${JSON.stringify(driverUrl)});
    try {
      const value = await driver.scrollAfterBringToFront(930211, "down", 5, 930212, { x: 914, y: 764, settleMs: 0 });
      console.log(JSON.stringify({ value, calls }));
    } catch (error) {
      console.log(JSON.stringify({ error: error.message, calls }));
    }
  `);

  assert.equal(output.error, undefined, JSON.stringify(output.error));
  assert.equal(output.value.activation.landed_on_target, false);
  assert.equal(output.value.result, null);
  assert.deepEqual(output.calls.map(({ tool }) => tool), ["bring_to_front"]);
});

test("hotkey fallback does not escalate on a different structured refusal", () => {
  const driverUrl = new URL("./driver.mjs", import.meta.url).href;
  const output = runIsolatedCuaScript(`
    import childProcess from "node:child_process";
    import { syncBuiltinESMExports } from "node:module";
    const calls = [];
    childProcess.spawnSync = (_binary, argv, options) => {
      calls.push({ tool: argv[1], args: JSON.parse(options.input) });
      return { status: 1, stdout: "", stderr: JSON.stringify({ refusal: { code: "stale_element_token" } }) };
    };
    syncBuiltinESMExports();
    const driver = await import(${JSON.stringify(driverUrl)});
    try {
      driver.callWithForegroundFallback("hotkey", { pid: 930111, keys: ["ctrl", "k"] });
      console.log(JSON.stringify({ calls }));
    } catch (error) {
      console.log(JSON.stringify({ error: error.message, calls }));
    }
  `);

  assert.match(output.error, /stale_element_token/);
  assert.equal(output.calls.length, 1);
  assert.equal(output.calls[0].args.delivery_mode, undefined);
});

test("clickBy refreshes the UIA snapshot and re-finds a stale element once", () => {
  const driverUrl = new URL("./driver.mjs", import.meta.url).href;
  const findUtilUrl = new URL("./find-util.mjs", import.meta.url).href;
  const output = runIsolatedCuaScript(`
    import childProcess from "node:child_process";
    import { syncBuiltinESMExports } from "node:module";
    const calls = [];
    childProcess.spawnSync = (_binary, argv, options) => {
      const tool = argv[1];
      const args = JSON.parse(options.input);
      calls.push({ tool, args });
      if (tool === "click" && args.element_token === "expired-token") {
        return {
          status: 1,
          stdout: "",
          stderr: JSON.stringify({ refusal: { code: "stale_element_token" } }),
        };
      }
      if (tool === "get_window_state") {
        return {
          status: 0,
          stdout: JSON.stringify({
            pid: args.pid,
            window_id: args.window_id,
            elements: [{ role: "Button", label: "Stop generating", element_token: "fresh-token" }],
          }),
          stderr: "",
        };
      }
      if (tool === "click" && args.element_token === "fresh-token") {
        return { status: 0, stdout: JSON.stringify({ clicked: true }), stderr: "" };
      }
      return { status: 1, stdout: "", stderr: JSON.stringify({ code: "unexpected_call" }) };
    };
    syncBuiltinESMExports();
    await import(${JSON.stringify(driverUrl)});
    const { clickBy } = await import(${JSON.stringify(findUtilUrl)});
    const state = {
      pid: 930121,
      window_id: 930122,
      elements: [{ role: "Button", label: "Stop generating", element_token: "expired-token" }],
    };
    try {
      const value = clickBy(930121, state, { role: "Button", name: "Stop generating" });
      console.log(JSON.stringify({ value, calls }));
    } catch (error) {
      console.log(JSON.stringify({ error: error.message, calls }));
    }
  `);

  assert.equal(output.error, undefined, JSON.stringify(output.error));
  assert.deepEqual(output.value, { clicked: true });
  assert.deepEqual(output.calls.map(({ tool }) => tool), ["click", "get_window_state", "click"]);
  assert.equal(output.calls[0].args.element_token, "expired-token");
  assert.equal(output.calls[0].args.pid, 930121);
  assert.equal(output.calls[0].args.window_id, 930122);
  assert.equal(output.calls[1].args.include_screenshot, false);
  assert.equal(output.calls[1].args.pid, 930121);
  assert.equal(output.calls[1].args.window_id, 930122);
  assert.equal(output.calls[2].args.element_token, "fresh-token");
  assert.equal(output.calls[2].args.pid, 930121);
  assert.equal(output.calls[2].args.window_id, 930122);
});

test("clickBy refuses a stale-token retry when the refreshed window identity changes", () => {
  const driverUrl = new URL("./driver.mjs", import.meta.url).href;
  const findUtilUrl = new URL("./find-util.mjs", import.meta.url).href;
  const output = runIsolatedCuaScript(`
    import childProcess from "node:child_process";
    import { syncBuiltinESMExports } from "node:module";
    const calls = [];
    childProcess.spawnSync = (_binary, argv, options) => {
      const tool = argv[1];
      const args = JSON.parse(options.input);
      calls.push({ tool, args });
      if (tool === "click" && args.element_token === "expired-token") {
        return {
          status: 1,
          stdout: "",
          stderr: JSON.stringify({ refusal: { code: "stale_element_token" } }),
        };
      }
      if (tool === "get_window_state") {
        return {
          status: 0,
          stdout: JSON.stringify({
            pid: args.pid,
            window_id: args.window_id + 1,
            elements: [{ role: "Button", label: "Stop generating", element_token: "new-window-token" }],
          }),
          stderr: "",
        };
      }
      if (tool === "click") {
        return { status: 0, stdout: JSON.stringify({ clicked: true }), stderr: "" };
      }
      return { status: 1, stdout: "", stderr: JSON.stringify({ code: "unexpected_call" }) };
    };
    syncBuiltinESMExports();
    await import(${JSON.stringify(driverUrl)});
    const { clickBy } = await import(${JSON.stringify(findUtilUrl)});
    const state = {
      pid: 930131,
      window_id: 930132,
      elements: [{ role: "Button", label: "Stop generating", element_token: "expired-token" }],
    };
    try {
      const value = clickBy(930131, state, { role: "Button", name: "Stop generating" });
      console.log(JSON.stringify({ value, calls }));
    } catch (error) {
      console.log(JSON.stringify({ error: error.message, calls }));
    }
  `);

  assert.match(output.error ?? "", /window identity changed/i);
  assert.deepEqual(output.calls.map(({ tool }) => tool), ["click", "get_window_state"]);
  assert.equal(output.calls[0].args.pid, 930131);
  assert.equal(output.calls[0].args.window_id, 930132);
  assert.equal(output.calls[1].args.pid, 930131);
  assert.equal(output.calls[1].args.window_id, 930132);
});

test("clickBy refuses a stale-token retry when the refreshed pid changes", () => {
  const driverUrl = new URL("./driver.mjs", import.meta.url).href;
  const findUtilUrl = new URL("./find-util.mjs", import.meta.url).href;
  const output = runIsolatedCuaScript(`
    import childProcess from "node:child_process";
    import { syncBuiltinESMExports } from "node:module";
    const calls = [];
    childProcess.spawnSync = (_binary, argv, options) => {
      const tool = argv[1];
      const args = JSON.parse(options.input);
      calls.push({ tool, args });
      if (tool === "click" && args.element_token === "expired-token") {
        return { status: 1, stdout: "", stderr: JSON.stringify({ code: "stale_element_token" }) };
      }
      if (tool === "get_window_state") {
        return {
          status: 0,
          stdout: JSON.stringify({
            pid: args.pid + 1,
            window_id: args.window_id,
            elements: [{ role: "Button", label: "Stop generating", element_token: "other-process-token" }],
          }),
          stderr: "",
        };
      }
      if (tool === "click") return { status: 0, stdout: JSON.stringify({ clicked: true }), stderr: "" };
      return { status: 1, stdout: "", stderr: JSON.stringify({ code: "unexpected_call" }) };
    };
    syncBuiltinESMExports();
    await import(${JSON.stringify(driverUrl)});
    const { clickBy } = await import(${JSON.stringify(findUtilUrl)});
    const state = { pid: 930141, window_id: 930142, elements: [{ role: "Button", label: "Stop generating", element_token: "expired-token" }] };
    try {
      const value = clickBy(930141, state, { role: "Button", name: "Stop generating" });
      console.log(JSON.stringify({ value, calls }));
    } catch (error) {
      console.log(JSON.stringify({ error: error.message, calls }));
    }
  `);

  assert.match(output.error ?? "", /window identity changed/i);
  assert.deepEqual(output.calls.map(({ tool }) => tool), ["click", "get_window_state"]);
  assert.equal(output.calls[1].args.pid, 930141);
  assert.equal(output.calls[1].args.window_id, 930142);
});

test("clickBy refuses a stale-token retry when the refreshed identity is missing", () => {
  const driverUrl = new URL("./driver.mjs", import.meta.url).href;
  const findUtilUrl = new URL("./find-util.mjs", import.meta.url).href;
  const output = runIsolatedCuaScript(`
    import childProcess from "node:child_process";
    import { syncBuiltinESMExports } from "node:module";
    const calls = [];
    childProcess.spawnSync = (_binary, argv, options) => {
      const tool = argv[1];
      const args = JSON.parse(options.input);
      calls.push({ tool, args });
      if (tool === "click" && args.element_token === "expired-token") {
        return { status: 1, stdout: "", stderr: JSON.stringify({ code: "stale_element_token" }) };
      }
      if (tool === "get_window_state") {
        return {
          status: 0,
          stdout: JSON.stringify({ elements: [{ role: "Button", label: "Stop generating", element_token: "unknown-identity-token" }] }),
          stderr: "",
        };
      }
      if (tool === "click") return { status: 0, stdout: JSON.stringify({ clicked: true }), stderr: "" };
      return { status: 1, stdout: "", stderr: JSON.stringify({ code: "unexpected_call" }) };
    };
    syncBuiltinESMExports();
    await import(${JSON.stringify(driverUrl)});
    const { clickBy } = await import(${JSON.stringify(findUtilUrl)});
    const state = { pid: 930151, window_id: 930152, elements: [{ role: "Button", label: "Stop generating", element_token: "expired-token" }] };
    try {
      const value = clickBy(930151, state, { role: "Button", name: "Stop generating" });
      console.log(JSON.stringify({ value, calls }));
    } catch (error) {
      console.log(JSON.stringify({ error: error.message, calls }));
    }
  `);

  assert.match(output.error ?? "", /identity fields are missing/i);
  assert.deepEqual(output.calls.map(({ tool }) => tool), ["click", "get_window_state"]);
  assert.equal(output.calls[1].args.pid, 930151);
  assert.equal(output.calls[1].args.window_id, 930152);
});

test("clickBy stops after one refreshed-token retry", () => {
  const driverUrl = new URL("./driver.mjs", import.meta.url).href;
  const findUtilUrl = new URL("./find-util.mjs", import.meta.url).href;
  const output = runIsolatedCuaScript(`
    import childProcess from "node:child_process";
    import { syncBuiltinESMExports } from "node:module";
    const calls = [];
    childProcess.spawnSync = (_binary, argv, options) => {
      const tool = argv[1];
      const args = JSON.parse(options.input);
      calls.push({ tool, args });
      if (tool === "click") {
        return { status: 1, stdout: "", stderr: JSON.stringify({ refusal: { code: "stale_element_token" } }) };
      }
      if (tool === "get_window_state") {
        return {
          status: 0,
          stdout: JSON.stringify({
            pid: args.pid,
            window_id: args.window_id,
            elements: [{ role: "Button", label: "Stop generating", element_token: "fresh-token" }],
          }),
          stderr: "",
        };
      }
      return { status: 1, stdout: "", stderr: JSON.stringify({ code: "unexpected_call" }) };
    };
    syncBuiltinESMExports();
    await import(${JSON.stringify(driverUrl)});
    const { clickBy } = await import(${JSON.stringify(findUtilUrl)});
    const state = { pid: 930161, window_id: 930162, elements: [{ role: "Button", label: "Stop generating", element_token: "expired-token" }] };
    try {
      const value = clickBy(930161, state, { role: "Button", name: "Stop generating" });
      console.log(JSON.stringify({ value, calls }));
    } catch (error) {
      console.log(JSON.stringify({ error: error.message, calls }));
    }
  `);

  assert.match(output.error ?? "", /stale_element_token/);
  assert.deepEqual(output.calls.map(({ tool }) => tool), ["click", "get_window_state", "click"]);
  assert.equal(output.calls.filter(({ tool }) => tool === "click").length, 2);
  assert.equal(output.calls[0].args.element_token, "expired-token");
  assert.equal(output.calls[2].args.element_token, "fresh-token");
  assert.equal(output.calls[0].args.window_id, 930162);
  assert.equal(output.calls[2].args.window_id, 930162);
});
