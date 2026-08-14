// verify/restart-persistence.mjs
// ---------------------------------------------------------------------------
// Verify that the provider config and API key persist across app restarts.
// Spawns the INSTALLED daemon (with --require preload) WITHOUT calling login.
// If the daemon reads auth.json on boot, the chat should work with the
// persisted API key — no manual re-entry needed.
//
// Usage: node verify/restart-persistence.mjs
// ---------------------------------------------------------------------------

import { execFileSync, spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const INSTALL_DIR = resolve(process.env.LOCALAPPDATA, "Sophos");
const NODE_EXE = join(INSTALL_DIR, "node", "node.exe");
const DAEMON_CLI = join(INSTALL_DIR, "daemon", "dist", "cli.js");
const BRIDGE_CLI = join(INSTALL_DIR, "bridge", "dist", "bridge", "src", "index.js");
const PRELOAD = join(INSTALL_DIR, "scripts", "no-window-preload.cjs");

const DAEMON_PORT = Number(process.env.DAEMON_PORT || (48300 + Math.floor(Math.random() * 500)));
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
  }
}

// --- Verify auth.json has the persisted key ---
const authPath = resolve(process.env.USERPROFILE, ".prime", "agent", "auth.json");
const authData = JSON.parse(readFileSync(authPath, "utf8"));
check("auth.json has persisted ollama-cloud key", Boolean(authData["ollama-cloud"]?.key), `key length=${authData["ollama-cloud"]?.key?.length || 0}`);

// --- Verify settings.json has the provider config ---
const settingsPath = resolve(process.env.USERPROFILE, ".prime", "agent", "settings.json");
const settings = JSON.parse(readFileSync(settingsPath, "utf8"));
check("settings.json has defaultProvider", settings.defaultProvider === "ollama-cloud", `provider=${settings.defaultProvider}`);
check("settings.json has defaultModel", settings.defaultModel === "deepseek-v4-flash:0731-cloud", `model=${settings.defaultModel}`);

// --- Spawn daemon WITHOUT login — test if it can use the persisted key ---
console.log("\n--- Spawning daemon (NO login — testing persisted key) ---");
const daemon = spawn(NODE_EXE, [
  "--require", PRELOAD,
  DAEMON_CLI, "--mode", "daemon",
  "--daemon-socket", SOCKET,
], {
  env: { ...process.env, PRIME_DAEMON_TCP: "1" },
  stdio: ["pipe", "pipe", "pipe"],
});

// Wait for daemon
const net = await import("node:net");
let daemonReady = false;
for (let i = 0; i < 30; i++) {
  try {
    const s = new net.Socket();
    await new Promise((res, rej) => { s.setTimeout(500); s.on("connect", () => { s.destroy(); res(); }); s.on("error", rej); s.on("timeout", () => { s.destroy(); rej(); }); s.connect(DAEMON_PORT, "127.0.0.1"); });
    daemonReady = true; break;
  } catch { await sleep(500); }
}
check("daemon spawned and listening (TCP)", daemonReady, `port=${DAEMON_PORT}`);

if (!daemonReady) {
  console.log("Daemon failed to start");
  terminateProcessTree(daemon);
  process.exit(1);
}

// --- Spawn bridge ---
const bridge = spawn(NODE_EXE, [BRIDGE_CLI, "--daemon-socket", SOCKET], {
  env: { ...process.env, PRIME_DAEMON_TCP: "1" },
  stdio: ["pipe", "pipe", "pipe"],
});

class BridgeClient {
  constructor(proc) {
    this.proc = proc; this.pending = new Map(); this.nextId = 1;
    this.events = []; this.connected = false;
    createInterface({ input: proc.stdout }).on("line", (line) => {
      let obj; try { obj = JSON.parse(line.trim()); } catch { return; }
      if (obj.type) {
        this.events.push(obj);
        if (obj.type === "connection_status" && obj.status?.kind === "connected") this.connected = true;
      }
      if (obj.id !== undefined && this.pending.has(String(obj.id))) {
        const p = this.pending.get(String(obj.id)); this.pending.delete(String(obj.id));
        if (obj.error) p.reject(new Error(obj.error.message)); else p.resolve(obj.result);
      }
    });
  }
  call(method, params = {}, timeout = 120000) {
    const id = String(this.nextId++);
    return new Promise((res, rej) => {
      const t = setTimeout(() => rej(new Error(`timeout: ${method}`)), timeout);
      this.pending.set(id, { resolve: v => { clearTimeout(t); res(v); }, reject: e => { clearTimeout(t); rej(e); } });
      this.proc.stdin.write(JSON.stringify({ id, method, params }) + "\n");
    });
  }
}

const client = new BridgeClient(bridge);
for (let i = 0; i < 20; i++) { if (client.connected) break; await sleep(500); }
check("bridge connected to daemon", client.connected);

// --- KEY TEST: setModel + newSession + prompt WITHOUT login ---
// The daemon should read auth.json on boot and have the API key available.
console.log("\n--- Testing chat WITHOUT login (persisted key) ---");

try {
  await client.call("setModel", { provider: "ollama-cloud", model: "deepseek-v4-flash:0731-cloud" }, 30000);
  check("setModel (no login needed)", true);
} catch (e) {
  check("setModel (no login needed)", false, e.message);
}

try {
  const session = await client.call("newSession", { cwd: tmpdir() }, 30000);
  check("newSession", true, `sessionId=${session?.activeSessionId || session?.id}`);
} catch (e) {
  check("newSession", false, e.message);
}

try {
  await client.call("prompt", { text: "What is 2+2? Reply with just the number." }, 10000);
  check("prompt ack", true);
} catch (e) {
  check("prompt ack", false, e.message);
}

// Wait for the response
console.log("Waiting for LLM response (persisted key test)...");
let sawAssistantResponse = false;
const sessionKinds = new Set();
const deadline = Date.now() + 60000;

while (Date.now() < deadline) {
  await sleep(2000);
  for (const ev of client.events) {
    if (ev.type === "session_event" && ev.event?.kind) {
      sessionKinds.add(ev.event.kind);
      const kind = ev.event.kind;
      if (/message_end|message_update/.test(kind)) {
        const msg = ev.event?.message;
        if (msg?.role === "assistant" && msg?.content?.length > 0) {
          // Check if the assistant has actual text content (not just empty)
          const hasText = msg.content.some(c => c.type === "text" && c.text?.trim());
          if (hasText) {
            sawAssistantResponse = true;
            console.log(`  [ASSISTANT RESPONSE] ${JSON.stringify(msg.content).slice(0, 200)}`);
          }
        }
      }
    }
  }
  if (sawAssistantResponse) break;
}

check("LLM responded using persisted API key (no login)", sawAssistantResponse,
  sawAssistantResponse ? "assistant response received" : `kinds: ${[...sessionKinds].join(", ")}`);

console.log(`\n  Session event kinds: ${[...sessionKinds].join(", ")}`);
console.log(`  Total events: ${client.events.length}`);

// --- Cleanup ---
terminateProcessTree(daemon);
terminateProcessTree(bridge);
await sleep(2000);

console.log(`\n======== RESTART PERSISTENCE TEST ========\nPASS: ${passCount}  FAIL: ${failCount}`);

const report = {
  startedAt: new Date().toISOString(),
  results,
  summary: { pass: passCount, fail: failCount, overall: failCount === 0 ? "PASS" : "FAIL" },
};
writeFileSync(join(REPO_ROOT, "verify", "restart-persistence-report.json"), JSON.stringify(report, null, 2));

process.exit(failCount === 0 ? 0 : 1);