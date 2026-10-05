#!/usr/bin/env node
// Focused wire-level regression for malformed JSON-RPC requests.
// Builds the actual bridge entry as a child process and checks its stdout lines.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { setTimeout as sleep } from "node:timers/promises";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BRIDGE = process.env.BRIDGE ?? join(REPO_ROOT, "resources", "bridge", "dist", "bridge", "src", "index.js");
const privateHome = mkdtempSync(join(tmpdir(), "bridge-rpc-wire-"));
const socketPath = process.platform === "win32"
  ? `\\\\.\\pipe\\bridge-rpc-wire-${process.pid}`
  : join(privateHome, "daemon.sock");
const isolatedEnv = {
  PATH: process.env.PATH ?? "",
  ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}),
  ...(process.env.WINDIR ? { WINDIR: process.env.WINDIR } : {}),
  LANG: "C",
  LC_ALL: "C",
  TZ: "UTC",
  HOME: privateHome,
  USERPROFILE: privateHome,
  APPDATA: join(privateHome, "AppData", "Roaming"),
  LOCALAPPDATA: join(privateHome, "AppData", "Local"),
  XDG_CONFIG_HOME: join(privateHome, ".config"),
  XDG_DATA_HOME: join(privateHome, ".local", "share"),
  XDG_CACHE_HOME: join(privateHome, ".cache"),
  TMPDIR: tmpdir(),
  TEMP: tmpdir(),
  TMP: tmpdir(),
  PI_OFFLINE: "1",
};

let child;
let stdoutBuffer = "";
const stdoutLines = [];
const responses = [];
let stderr = "";

function onStdout(chunk) {
  stdoutBuffer += chunk.toString();
  let newline;
  while ((newline = stdoutBuffer.indexOf("\n")) !== -1) {
    const line = stdoutBuffer.slice(0, newline).trim();
    stdoutBuffer = stdoutBuffer.slice(newline + 1);
    if (!line) continue;
    stdoutLines.push(line);
    let parsed;
    try { parsed = JSON.parse(line); } catch { continue; }
    if (parsed && typeof parsed === "object"
      && (Object.hasOwn(parsed, "result") || Object.hasOwn(parsed, "error"))) {
      responses.push(parsed);
    }
  }
}

async function waitForResponseCount(count, timeoutMs = 2500) {
  const deadline = Date.now() + timeoutMs;
  while (responses.length < count && Date.now() < deadline) await sleep(10);
}

try {
  child = spawn(process.execPath, [BRIDGE, "--daemon-socket", socketPath], {
    cwd: REPO_ROOT,
    env: isolatedEnv,
    stdio: ["pipe", "pipe", "pipe"],
  });
  child.stdout.on("data", onStdout);
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  child.once("error", (error) => { stderr += `${error.stack ?? error}\n`; });

  const incoming = [
    "not-json-at-all{",
    JSON.stringify({ jsonrpc: "2.0", id: "missing-method" }),
    JSON.stringify([]),
    JSON.stringify({ jsonrpc: "1.0", id: "wrong-version", method: "getState", params: {} }),
    JSON.stringify({ jsonrpc: "2.0", id: true, method: "getState", params: {} }),
    JSON.stringify({ jsonrpc: "2.0", id: "scalar-params", method: "getState", params: "not-structured" }),
    // The in-product shell legitimately omits `jsonrpc`; a present null ID is
    // still a request and must produce a response whose ID is exactly null.
    JSON.stringify({ id: null, method: "getState", params: {} }),
    JSON.stringify({ jsonrpc: "2.0", id: "request-id", method: "getState", params: {} }),
    // An absent ID is a notification and must not produce a response.
    JSON.stringify({ method: "getState", params: {} }),
  ];
  child.stdin.write(`${incoming.join("\n")}\n`);
  await waitForResponseCount(8);
  // Allow any erroneous notification response or duplicate frame to arrive.
  await sleep(150);

  assert.equal(responses.length, 8,
    `expected eight responses for nine incoming lines (notification omitted), got ${responses.length}; stdout=${JSON.stringify(stdoutLines)}; stderr=${stderr}`);
  assert.equal(responses.filter((response) => response.error?.code === -32700).length, 1,
    `expected one -32700 parse error; responses=${JSON.stringify(responses)}`);
  const parseError = responses.find((response) => response.error?.code === -32700);
  assert.equal(parseError.id, null, "parse-error response must carry an explicit null ID");

  const invalidRequests = responses.filter((response) => response.error?.code === -32600);
  assert.equal(invalidRequests.length, 5,
    `expected five -32600 invalid-request responses; responses=${JSON.stringify(responses)}`);
  assert.ok(invalidRequests.every((response) => Object.hasOwn(response, "id") && response.id === null),
    `invalid-request responses must carry explicit null IDs; responses=${JSON.stringify(invalidRequests)}`);

  const nullIdResponse = responses.find((response) => response.id === null && Object.hasOwn(response, "result"));
  assert.ok(nullIdResponse, `explicit null-ID request needs its own success response: ${JSON.stringify(responses)}`);
  assert.equal(typeof nullIdResponse.result?.status?.kind, "string",
    `null-ID getState request should have executed: ${JSON.stringify(nullIdResponse)}`);

  const ordinaryResponse = responses.find((response) => response.id === "request-id");
  assert.ok(ordinaryResponse && ordinaryResponse.result?.status?.kind,
    `valid JSON-RPC 2.0 request should be answered with its ID: ${JSON.stringify(responses)}`);
  assert.equal(responses.some((response) => response.id === "wrong-version" || response.id === "missing-method"
    || response.id === true || response.id === "scalar-params"), false,
  "invalid requests must not echo an untrusted/malformed ID");

  console.log("PASS  malformed JSON returns -32700 with explicit null id");
  console.log("PASS  missing method, invalid version, invalid ID, invalid params shape return -32600/null id");
  console.log("PASS  explicit null-ID request returns one real getState result; missing-ID notification returns none");
  console.log(`PASS  actual bridge stdout contains ${responses.length} RPC responses for ${incoming.length} incoming lines`);
} catch (error) {
  console.error(`FAIL  RPC wire regression: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  if (child && child.exitCode === null) {
    child.kill("SIGTERM");
    await Promise.race([
      new Promise((resolve) => child.once("exit", resolve)),
      sleep(1500),
    ]);
    if (child.exitCode === null) child.kill("SIGKILL");
  }
  rmSync(privateHome, { recursive: true, force: true });
}
