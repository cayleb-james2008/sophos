import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import test from "node:test";
import { join, win32 } from "node:path";

import * as driver from "./driver.mjs";

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
