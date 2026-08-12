// Focused bridge lifecycle check.
// Uses TCP so daemon replacement is deterministic even on hosts with flaky
// named-pipe teardown, while the normal verifier continues to cover the
// production/default transport separately.

import { strict as assert } from "node:assert";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { createServer } from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const VERIFY = join(HERE, "verify.mjs");
const { isRecoverableDaemonClose } = await import("./dist/bridge/src/connection.js");
assert.equal(isRecoverableDaemonClose("Lost connection to the Prime Agent daemon. Cause: socket closed."), true);
assert.equal(isRecoverableDaemonClose("The daemon closed this agent session after it completed."), false);
assert.equal(isRecoverableDaemonClose("The Prime Agent daemon shut down while this window was attached."), false);

const server = createServer();
server.once("error", (error) => {
  console.error(`failed to allocate lifecycle test port: ${error.message}`);
  process.exit(1);
});
server.listen(0, "127.0.0.1", () => {
  const address = server.address();
  if (!address || typeof address === "string") {
    console.error("failed to inspect lifecycle test port");
    process.exit(1);
  }
  server.close(() => {
    const isolatedHome = mkdtempSync(join(tmpdir(), "sophos-bridge-lifecycle-"));
    const child = spawn(process.execPath, [VERIFY], {
      cwd: HERE,
      stdio: "inherit",
      env: {
        ...process.env,
        HOME: isolatedHome,
        USERPROFILE: isolatedHome,
        BRIDGE_VERIFY_RECOVERY: "1",
        BRIDGE_VERIFY_SOCKET: `tcp://127.0.0.1:${address.port}`,
      },
    });
    child.once("error", (error) => {
      console.error(`failed to start lifecycle verifier: ${error.message}`);
      process.exit(1);
    });
    child.once("exit", (code, signal) => {
      rmSync(isolatedHome, { recursive: true, force: true });
      if (signal) {
        console.error(`lifecycle verifier stopped with ${signal}`);
        process.exit(1);
      }
      process.exit(code ?? 1);
    });
  });
});
