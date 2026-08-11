// Focused concurrency check for the auxiliary bridge verifier.
// Each child verifier chooses its own named-pipe/Unix-socket path. This test
// intentionally starts both at once so a shared default socket would fail.

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const VERIFY = join(HERE, "verify.mjs");
const CHILD_TIMEOUT_MS = 120_000;

function runVerifier(index) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [VERIFY], {
      cwd: HERE,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env },
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, CHILD_TIMEOUT_MS);
    child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      const socket = stdout.match(/^BRIDGE_VERIFY_SOCKET=(.+)$/m)?.[1];
      resolve({ index, code, signal, timedOut, socket, stdout, stderr });
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ index, code: null, signal: null, timedOut, error: error.message, stdout, stderr });
    });
  });
}

const results = await Promise.all([runVerifier(1), runVerifier(2)]);
const sockets = results.map((result) => result.socket).filter(Boolean);
const uniqueSockets = new Set(sockets);
const passed = results.every((result) => result.code === 0 && !result.timedOut)
  && sockets.length === 2
  && uniqueSockets.size === 2
  && results.every((result) => !/already in use|address already in use|EADDRINUSE/i.test(result.stdout + result.stderr));

for (const result of results) {
  console.log(`verifier-${result.index}: ${result.code === 0 && !result.timedOut ? "PASS" : "FAIL"} socket=${result.socket ?? "missing"}`);
  if (result.code !== 0 || result.timedOut) {
    console.log(result.stdout);
    console.error(result.stderr);
    if (result.error) console.error(result.error);
  }
}
console.log(`concurrent isolated verifier: ${passed ? "PASS" : "FAIL"}`);
process.exit(passed ? 0 : 1);
