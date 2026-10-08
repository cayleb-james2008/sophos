// Focused bridge lifecycle check using the pinned daemon's supported local
// socket transport. Prime Agent v0.7.0 treats tcp:// as a filesystem path.

import { strict as assert } from "node:assert";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  E2E_MOCK_MODEL_ID,
  E2E_MOCK_PROVIDER_ID,
  startE2EMockProvider,
  writeE2EMockProviderConfig,
} from "../verify/e2e-mock-provider.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const VERIFY = join(HERE, "verify.mjs");
const { isRecoverableDaemonClose } = await import("./dist/bridge/src/connection.js");
assert.equal(isRecoverableDaemonClose("Lost connection to the Prime Agent daemon. Cause: socket closed."), true);
assert.equal(isRecoverableDaemonClose("The daemon closed this agent session after it completed."), false);
assert.equal(isRecoverableDaemonClose("The Prime Agent daemon shut down while this window was attached."), false);

async function run() {
  const isolatedHome = mkdtempSync(join(tmpdir(), "sophos-bridge-lifecycle-"));
  let mockProvider;
  let succeeded = false;
  try {
    mockProvider = await startE2EMockProvider();
    writeE2EMockProviderConfig(isolatedHome, mockProvider.baseUrl);
    const isolatedEnv = Object.fromEntries(
      ["PATH", "SystemRoot", "WINDIR", "COMSPEC", "PATHEXT", "SystemDrive", "LANG", "LC_ALL", "TZ", "REF", "BRIDGE"]
        .filter((name) => process.env[name] !== undefined)
        .map((name) => [name, process.env[name]]),
    );
    const child = spawn(process.execPath, [VERIFY], {
      cwd: isolatedHome,
      stdio: "inherit",
      env: {
        ...isolatedEnv,
        HOME: isolatedHome,
        USERPROFILE: isolatedHome,
        XDG_CONFIG_HOME: join(isolatedHome, ".config"),
        XDG_DATA_HOME: join(isolatedHome, ".local", "share"),
        XDG_CACHE_HOME: join(isolatedHome, ".cache"),
        APPDATA: join(isolatedHome, "AppData", "Roaming"),
        LOCALAPPDATA: join(isolatedHome, "AppData", "Local"),
        TMPDIR: tmpdir(),
        TEMP: tmpdir(),
        TMP: tmpdir(),
        PI_OFFLINE: "1",
        BRIDGE_VERIFY_RECOVERY: "1",
        BRIDGE_VERIFY_MODEL_PROVIDER: E2E_MOCK_PROVIDER_ID,
        BRIDGE_VERIFY_MODEL_ID: E2E_MOCK_MODEL_ID,
      },
    });
    const outcome = await new Promise((resolve, reject) => {
      child.once("error", (error) => reject(new Error(`failed to start lifecycle verifier: ${error.message}`)));
      child.once("exit", (code, signal) => resolve({ code, signal }));
    });
    if (outcome.signal) throw new Error(`lifecycle verifier stopped with ${outcome.signal}`);
    if (outcome.code !== 0) throw new Error(`lifecycle verifier exited with code ${outcome.code ?? "unknown"}`);
    if (mockProvider.requestCount === 0) throw new Error("lifecycle recovery did not use the loopback mock provider");
    succeeded = true;
    console.log(`lifecycle recovery used ${mockProvider.requestCount} loopback mock-provider request(s)`);
  } finally {
    await mockProvider?.close();
    if (succeeded) rmSync(isolatedHome, { recursive: true, force: true });
    else console.error(`preserved isolated lifecycle HOME for diagnostics: ${isolatedHome}`);
  }
}

run().catch((error) => {
  console.error(`lifecycle verifier failed: ${error.message}`);
  process.exitCode = 1;
});
