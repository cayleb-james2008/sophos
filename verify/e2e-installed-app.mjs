// verify/e2e-installed-app.mjs
// ---------------------------------------------------------------------------
// E2E validation of the INSTALLED Sophos app — P3: Provider + Chat → Tool Call.
//
// Spawns the INSTALLED app's daemon (with --require preload) + bridge sidecar
// on a TCP port, then drives the full IPC round-trip:
//   1. login (ollama-cloud provider)
//   2. setModel (deepseek-v4-flash)
//   3. newSession
//   4. prompt (a message that triggers a tool call — e.g., "list files")
//   5. wait for session events (tool call execution + response)
//
// Uses the INSTALLED binaries from ~\AppData\Local\Sophos\ — not the dev
// checkout — so this proves the shipped app's chat → tool call flow works.
//
// Usage: node verify/e2e-installed-app.mjs
// ---------------------------------------------------------------------------

import { execFileSync, spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const INSTALL_DIR = process.env.SOPHOS_INSTALL || resolve(process.env.LOCALAPPDATA, "Sophos");
const NODE_EXE = join(INSTALL_DIR, "node", "node.exe");
const DAEMON_CLI = join(INSTALL_DIR, "daemon", "dist", "cli.js");
const BRIDGE_CLI = join(INSTALL_DIR, "bridge", "dist", "bridge", "src", "index.js");
const PRELOAD = join(INSTALL_DIR, "scripts", "no-window-preload.cjs");

// Ollama Cloud credentials (from the pi setup — same provider used by the fleet)
const OLLAMA_KEY = process.env.OLLAMA_API_KEY || readFileSync(resolve(process.env.USERPROFILE, ".pi", "agent", "auth.json"), "utf8")
  .match(/"ollama-cloud":\s*\{\s*"key":\s*"([^"]+)"/)?.[1] || "";

const DAEMON_PORT = Number(process.env.DAEMON_PORT || (48200 + Math.floor(Math.random() * 500)));
const SOCKET = `tcp://127.0.0.1:${DAEMON_PORT}`;

const results = [];
let passCount = 0, failCount = 0;
function check(name, ok, detail = "") {
  results.push({ name, ok: Boolean(ok), detail });
  if (ok) passCount++; else failCount++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function terminateProcessTree(proc) {
  if (!proc?.pid || proc.exitCode !== null) return;
  if (process.platform === "win32") {
    try { execFileSync("taskkill", ["/PID", String(proc.pid), "/T", "/F"], { stdio: "ignore" }); } catch {}
    return;
  }
  try { proc.kill("SIGTERM"); } catch {}
}

// --- Layout check ---
check("installed node.exe exists", existsSync(NODE_EXE), NODE_EXE);
check("installed daemon/cli.js exists", existsSync(DAEMON_CLI), DAEMON_CLI);
check("installed bridge/index.js exists", existsSync(BRIDGE_CLI), BRIDGE_CLI);
check("installed preload exists", existsSync(PRELOAD), PRELOAD);
check("ollama-cloud API key available", OLLAMA_KEY.length > 20, `key length=${OLLAMA_KEY.length}`);

if (failCount > 0) {
  console.log(`\n======== LAYOUT FAILED ========\nPASS: ${passCount}  FAIL: ${failCount}`);
  process.exit(1);
}

// --- Spawn daemon (with --require preload, exactly as the Tauri shell does) ---
console.log("\n--- Spawning installed daemon (TCP mode, with --require preload) ---");
const daemonLog = [];
const daemon = spawn(NODE_EXE, [
  "--require", PRELOAD,
  DAEMON_CLI, "--mode", "daemon",
  "--daemon-socket", SOCKET,
], {
  env: { ...process.env, PRIME_DAEMON_TCP: "1" },
  stdio: ["pipe", "pipe", "pipe"],
});

daemon.stdout.on("data", (d) => {
  const lines = d.toString().split(/\r?\n/).filter(Boolean);
  for (const l of lines) daemonLog.push(l);
});
daemon.stderr.on("data", (d) => {
  const lines = d.toString().split(/\r?\n/).filter(Boolean);
  for (const l of lines) daemonLog.push(`[stderr] ${l}`);
});

// Wait for daemon to be ready (it listens on the TCP port)
console.log(`Waiting for daemon on ${SOCKET}...`);
let daemonReady = false;
const daemonReadyTimeout = setTimeout(() => {
  if (!daemonReady) {
    console.log("DAEMON TIMEOUT — logs:");
    console.log(daemonLog.slice(-20).join("\n"));
  }
}, 30000);

// Poll the TCP port
async function waitForDaemon(maxWaitMs = 30000) {
  const net = await import("node:net");
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    try {
      const sock = new net.Socket();
      await new Promise((res, rej) => {
        sock.setTimeout(1000);
        sock.on("connect", () => { sock.destroy(); res(); });
        sock.on("error", rej);
        sock.on("timeout", () => { sock.destroy(); rej(new Error("timeout")); });
        sock.connect(DAEMON_PORT, "127.0.0.1");
      });
      return true;
    } catch {
      await sleep(500);
    }
  }
  return false;
}

const daemonOk = await waitForDaemon();
clearTimeout(daemonReadyTimeout);
check("daemon spawned and listening on TCP", daemonOk, `port=${DAEMON_PORT}`);

if (!daemonOk) {
  console.log("Daemon logs:", daemonLog.slice(-30).join("\n"));
  terminateProcessTree(daemon);
  console.log(`\n======== DAEMON FAILED ========\nPASS: ${passCount}  FAIL: ${failCount}`);
  process.exit(1);
}

// --- Spawn bridge sidecar (exactly as the Tauri shell does) ---
console.log("--- Spawning installed bridge sidecar ---");
const bridge = spawn(NODE_EXE, [
  BRIDGE_CLI,
  "--daemon-socket", SOCKET,
], {
  env: { ...process.env, PRIME_DAEMON_TCP: "1" },
  stdio: ["pipe", "pipe", "pipe"],
});

// Bridge client: send commands on stdin, read events/responses on stdout
class BridgeClient {
  constructor(proc) {
    this.proc = proc;
    this.pending = new Map();
    this.nextId = 1;
    this.events = [];
    this.connected = false;
    this.rl = createInterface({ input: proc.stdout });
    this.rl.on("line", (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      let obj;
      try { obj = JSON.parse(trimmed); } catch { return; }
      if (obj.type) {
        this.events.push(obj);
        if (obj.type === "connection_status" && obj.status?.kind === "connected") {
          this.connected = true;
        }
        if (obj.type === "connection_status") {
          console.log(`  [event] connection_status: ${obj.status?.kind}`);
        }
        if (obj.type === "session_event") {
          const ev = obj.event;
          if (ev?.kind) console.log(`  [event] session_event: ${ev.kind}`);
        }
      }
      if (obj.id !== undefined && this.pending.has(String(obj.id))) {
        const p = this.pending.get(String(obj.id));
        this.pending.delete(String(obj.id));
        if (obj.error) p.reject(new Error(`${obj.error.code}: ${obj.error.message}`));
        else p.resolve(obj.result);
      }
    });
    proc.stderr.on("data", (d) => {
      const lines = d.toString().split(/\r?\n/).filter(Boolean);
      for (const l of lines) console.log(`  [bridge stderr] ${l}`);
    });
  }

  call(method, params = {}, timeout = 120000) {
    const id = String(this.nextId++);
    const line = JSON.stringify({ id, method, params });
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`timeout: ${method}`)), timeout);
      this.pending.set(id, { resolve: (v) => { clearTimeout(timer); resolve(v); }, reject: (e) => { clearTimeout(timer); reject(e); } });
      this.proc.stdin.write(line + "\n");
    });
  }
}

const bridgeClient = new BridgeClient(bridge);

// Wait for bridge to connect to daemon
console.log("Waiting for bridge to connect...");
let bridgeConnected = false;
for (let i = 0; i < 20; i++) {
  if (bridgeClient.connected) { bridgeConnected = true; break; }
  await sleep(500);
}
check("bridge connected to daemon", bridgeConnected, `events=${bridgeClient.events.length}`);

// --- IPC round-trip tests ---
console.log("\n--- IPC Round-Trip Tests ---");

// 1. Login with ollama-cloud provider
try {
  const loginResult = await bridgeClient.call("login", { provider: "ollama-cloud", apiKey: OLLAMA_KEY }, 30000);
  check("login (ollama-cloud)", true, JSON.stringify(loginResult).slice(0, 100));
  // Verify the key was persisted to auth.json
  const { readFileSync } = await import("node:fs");
  const { resolve: resolvePath } = await import("node:path");
  try {
    const authPath = resolvePath(process.env.USERPROFILE || process.env.HOME, ".prime", "agent", "auth.json");
    const authData = JSON.parse(readFileSync(authPath, "utf8"));
    const hasKey = Boolean(authData["ollama-cloud"]);
    check("API key persisted to auth.json", hasKey, hasKey ? `key length=${authData["ollama-cloud"].length}` : "not found");
  } catch (e) {
    check("API key persisted to auth.json", false, e.message);
  }
} catch (e) {
  check("login (ollama-cloud)", false, e.message);
}

// 2. Set model
try {
  const modelResult = await bridgeClient.call("setModel", {
    provider: "ollama-cloud",
    model: "deepseek-v4-flash:0731-cloud",
  }, 30000);
  check("setModel (deepseek-v4-flash)", true, JSON.stringify(modelResult).slice(0, 100));
} catch (e) {
  check("setModel (deepseek-v4-flash)", false, e.message);
}

// 3. Create a new session
let sessionId;
try {
  const sessionResult = await bridgeClient.call("newSession", { cwd: tmpdir() }, 30000);
  sessionId = sessionResult?.activeSessionId || sessionResult?.id;
  check("newSession", true, `sessionId=${sessionId}`);
} catch (e) {
  check("newSession", false, e.message);
}

// 4. Send a prompt that triggers a tool call
// "List the files in the current directory" should trigger a file-listing tool call
if (sessionId) {
  console.log("\n--- Sending prompt (triggers tool call) ---");
  try {
    const promptResult = await bridgeClient.call("prompt", {
      text: "List the files in the current directory. Use the appropriate tool.",
    }, 10000); // short timeout — just the ack
    check("prompt ack", true, JSON.stringify(promptResult).slice(0, 100));
  } catch (e) {
    check("prompt ack", false, e.message);
  }

  // Wait for session events (tool call + response)
  console.log("Waiting for session events (tool call execution)...");
  let sawToolCall = false;
  let sawAssistantMessage = false;
  let sawToolResult = false;
  const eventKinds = new Set();
  const eventDeadline = Date.now() + 90000; // 90s max

  while (Date.now() < eventDeadline) {
    await sleep(2000);
    for (const ev of bridgeClient.events) {
      if (ev.type === "session_event") {
        const inner = ev.event;
        const kind = inner?.kind || inner?.type;
        if (kind) eventKinds.add(kind);
        // Look for tool call events (check kind names used by the daemon)
        if (/tool|function|exec|action/i.test(kind || "")) {
          sawToolCall = true;
          console.log(`  [TOOL] ${kind}: ${JSON.stringify(inner).slice(0, 200)}`);
        }
        if (/tool_result|tool_output|function_call_output|exec.*result/i.test(kind || "")) {
          sawToolResult = true;
        }
        if (/assistant|message|text|content|reply|response/i.test(kind || "")) {
          sawAssistantMessage = true;
          console.log(`  [MSG] ${kind}: ${JSON.stringify(inner).slice(0, 200)}`);
        }
      }
    }
    if (sawAssistantMessage && (sawToolCall || sawToolResult)) break;
  }

  // Count session event kinds
  const sessionEventKinds = {};
  for (const ev of bridgeClient.events) {
    if (ev.type === "session_event" && ev.event?.kind) {
      sessionEventKinds[ev.event.kind] = (sessionEventKinds[ev.event.kind] || 0) + 1;
    }
  }
  console.log(`  Session event kind counts: ${JSON.stringify(sessionEventKinds)}`);

  // Broaden: check if any kinds indicate tool execution or assistant response
  const allKinds = Object.keys(sessionEventKinds);
  const toolRelated = allKinds.filter(k => /tool|function|exec|action/i.test(k));
  const assistantRelated = allKinds.filter(k => /assistant|message|text|content|reply|response/i.test(k));
  console.log(`  Tool-related kinds: ${toolRelated.join(", ") || "none"}`);
  console.log(`  Assistant-related kinds: ${assistantRelated.join(", ") || "none"}`);

  // Also check extension_ui_request events (which may contain tool-call indicators)
  const extRequests = bridgeClient.events.filter(e => e.type === "extension_ui_request");
  const extMethods = new Set();
  for (const e of extRequests) {
    if (e.request?.method) extMethods.add(e.request.method);
  }
  console.log(`  Extension UI request methods: ${[...extMethods].join(", ") || "none"}`);

  check("received tool call event", sawToolCall || sawToolResult || toolRelated.length > 0, `kinds: ${allKinds.join(", ")}`);
  check("received assistant response", sawAssistantMessage || assistantRelated.length > 0, `kinds: ${allKinds.join(", ")}`);
  check("event flow includes tool execution", sawToolCall || sawToolResult || toolRelated.length > 0, `kinds=${allKinds.join(",")}`);

  console.log(`\n  All session event kinds: ${allKinds.join(", ")}`);
  console.log(`  Total events received: ${bridgeClient.events.length}`);
} else {
  check("prompt (no session)", false, "no session was created");
}

// --- Console window check during IPC test ---
// The daemon was spawned with --require preload, so any tool call that
// spawns a child process should NOT flash a console window.
console.log("\n--- Post-IPC console window check ---");
try {
  const ps = join(tmpdir(), `post-ipc-windows-${process.pid}.ps1`);
  writeFileSync(ps, `Add-Type @"
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
public class WE${process.pid} {
  public delegate bool EP(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EP cb, IntPtr l);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr h, StringBuilder s, int m);
  [DllImport("user32.dll")] public static extern int GetWindowTextLength(IntPtr h);
  public static List<string> Titles() {
    var l = new List<string>();
    EnumWindows((h, x) => {
      if (IsWindowVisible(h)) { var len = GetWindowTextLength(h); if (len > 0) { var s = new StringBuilder(len+1); GetWindowText(h, s, len+1); l.Add(s.ToString()); } }
      return true;
    }, IntPtr.Zero);
    return l;
  }
}
"@
[WE${process.pid}]::Titles()`);
  const { spawnSync } = await import("node:child_process");
  const r = spawnSync("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", ps], { encoding: "utf8", windowsHide: true });
  const windows = (r.stdout || "").split(/\r?\n/).map(t => t.trim()).filter(Boolean);
  const consoleWindows = windows.filter(t => /cmd|command prompt|console|terminal|node/i.test(t));
  check("no console windows during IPC test", consoleWindows.length === 0, consoleWindows.length ? `found: ${consoleWindows.join("; ")}` : "none");
} catch (e) {
  check("no console windows during IPC test", false, e.message);
}

// --- Cleanup ---
console.log("\n--- Cleanup ---");
terminateProcessTree(daemon);
terminateProcessTree(bridge);
await sleep(2000);

// Final summary
console.log(`\n======== SUMMARY ========\nPASS: ${passCount}  FAIL: ${failCount}`);

// Write evidence
const topLevelTypeCounts = {};
for (const ev of bridgeClient.events) {
  topLevelTypeCounts[ev.type] = (topLevelTypeCounts[ev.type] || 0) + 1;
}
const evidence = {
  startedAt: new Date().toISOString(),
  installDir: INSTALL_DIR,
  daemonPort: DAEMON_PORT,
  results,
  eventTypes: [...new Set(bridgeClient.events.flatMap(e => e.event?.type ? [e.event.type] : []))],
  topLevelTypeCounts,
  totalEvents: bridgeClient.events.length,
  summary: { pass: passCount, fail: failCount, overall: failCount === 0 ? "PASS" : "FAIL" },
};
writeFileSync(join(REPO_ROOT, "verify", "e2e-installed-app-report.json"), JSON.stringify(evidence, null, 2));
console.log(`Report: verify/e2e-installed-app-report.json`);

process.exit(failCount === 0 ? 0 : 1);