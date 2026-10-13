// Focused bridge lifecycle check using the unique default socket/named pipe
// that the pinned daemon runtime supports.

import { strict as assert } from "node:assert";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const VERIFY = join(HERE, "verify.mjs");
const { isRecoverableDaemonClose } = await import("./dist/bridge/src/connection.js");
assert.equal(isRecoverableDaemonClose("Lost connection to the Prime Agent daemon. Cause: socket closed."), true);
assert.equal(isRecoverableDaemonClose("The daemon closed this agent session after it completed."), false);
assert.equal(isRecoverableDaemonClose("The Prime Agent daemon shut down while this window was attached."), false);

const isolatedHome = mkdtempSync(join(tmpdir(), "sophos-bridge-lifecycle-"));
const env = { ...process.env, HOME: isolatedHome, USERPROFILE: isolatedHome, BRIDGE_VERIFY_RECOVERY: "1" };
delete env.BRIDGE_VERIFY_SOCKET;

const child = spawn(process.execPath, [VERIFY], { cwd: HERE, stdio: "inherit", env });
child.once("error", (error) => {
  console.error(`failed to start lifecycle verifier: ${error.message}`);
  rmSync(isolatedHome, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  process.exit(1);
});
child.once("exit", (code, signal) => {
  rmSync(isolatedHome, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  if (signal) {
    console.error(`lifecycle verifier stopped with ${signal}`);
    process.exit(1);
  }
  process.exit(code ?? 1);
});
