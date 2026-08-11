#!/usr/bin/env node
/**
 * verify/e2e-safety.mjs — focused safety checks for verification tooling.
 *
 * This test is deliberately model-free and non-destructive. It checks the
 * source-level guardrails, then starts and stops one Vite process on an
 * ephemeral loopback port to prove the browser harness does not reuse 1420 or
 * stop a process it did not create.
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { startOwnedDevServer, stopOwnedDevServer } from "./e2e/helpers.mjs";

const verifyDir = dirname(fileURLToPath(import.meta.url));
const read = (name) => readFile(join(verifyDir, name), "utf8");

const browser = await read("e2e-browser.mjs");
const isolate = await read("e2e-isolate.mjs");
const daemon = await read("e2e.mjs");
const helper = await read("e2e/helpers.mjs");
const p5 = await read("e2e/p5-verify.mjs");

for (const [name, source] of Object.entries({ browser, isolate, daemon, helper, p5 })) {
  assert(!source.includes("killStrayChrome"), `${name} must not kill unrelated Chrome processes`);
  assert(!source.includes("killStrays"), `${name} must not scan and kill unrelated daemon processes`);
  assert(!source.includes("clearWorkers"), `${name} must not delete shared daemon/session state`);
}

assert(daemon.includes("sophos-e2e-home-"), "live daemon verifier must create a temporary HOME");
assert(daemon.includes("USERPROFILE: testHome"), "live daemon verifier must isolate Windows user profile state");
assert(daemon.includes("HOME: testHome"), "live daemon verifier must isolate HOME state");
assert(daemon.includes("sophos-e2e-${process.pid}-${Date.now()}"), "named-pipe verifier endpoint must be unique");
assert(helper.includes("owned ephemeral Vite server"), "browser reports must identify the owned server boundary");
assert(helper.includes("never probes or reuses port 1420"), "browser server helper must document fixed-port isolation");
assert(browser.includes("startOwnedDevServer") && isolate.includes("startOwnedDevServer"), "browser suites must start an owned server");
assert(browser.includes("MockIpcClient") && helper.includes("Demo mode — engine not connected"), "browser suites must assert the mock boundary");
assert(!browser.includes("localhost:1420") && !isolate.includes("localhost:1420") && !p5.includes("localhost:1420"), "browser suites must not target fixed port 1420");

const server = await startOwnedDevServer();
try {
  assert.notEqual(server.port, 1420, "owned browser server must use an ephemeral port");
  assert(server.proc.pid, "owned browser server must expose its child process");
  const response = await fetch(server.url);
  assert.equal(response.status, 200, "owned browser server must respond");
  const html = await response.text();
  assert(html.includes('<div id="root">'), "owned browser server must serve the Sophos app entrypoint");
  console.log(`PASS  owned browser server: ${server.url} (pid ${server.proc.pid})`);
} finally {
  await stopOwnedDevServer(server);
}

console.log("PASS  verification safety guardrails");
