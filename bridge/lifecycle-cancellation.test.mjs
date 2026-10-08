import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import test from "node:test";
import { requestLifecycleCancellation } from "./lifecycle-cancellation.mjs";

const cancellationModule = new URL("./lifecycle-cancellation.mjs", import.meta.url).href;

test("Windows lifecycle cancellation reaches cleanup over IPC and waits for child exit", async () => {
  const source = `
    import { isLifecycleCancellationMessage } from ${JSON.stringify(cancellationModule)};
    process.on("message", async (message) => {
      if (!isLifecycleCancellationMessage(message)) return;
      console.log("CLEANUP_CALLBACK_REACHED");
      await new Promise((resolve) => setTimeout(resolve, 75));
      console.log("CLEANUP_CALLBACK_FINISHED");
      process.exit(130);
    });
    setInterval(() => {}, 1000);
  `;
  const child = spawn(process.execPath, ["--input-type=module", "-e", source], {
    stdio: ["ignore", "pipe", "pipe", "ipc"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  try {
    const exited = once(child, "exit");
    assert.equal(requestLifecycleCancellation(child, "SIGTERM", "win32"), true);
    let timeout;
    const outcome = await Promise.race([
      exited,
      new Promise((_, reject) => {
        timeout = setTimeout(() => reject(new Error(`IPC cleanup did not finish: ${stdout}${stderr}`)), 5000);
        timeout.unref();
      }),
    ]).finally(() => clearTimeout(timeout));
    const [code, signal] = outcome;
    assert.equal(signal, null);
    assert.equal(code, 130);
    assert.match(stdout, /CLEANUP_CALLBACK_REACHED/);
    assert.match(stdout, /CLEANUP_CALLBACK_FINISHED/);
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
  }
});

test("POSIX lifecycle cancellation retains signal forwarding", () => {
  const child = { kill: (signal) => signal === "SIGTERM" };
  assert.equal(requestLifecycleCancellation(child, "SIGTERM", "linux"), true);
});
