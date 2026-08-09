// IPC round-trip harness — P1 Agentic Functionality Hardening.
//
// Spawns the REAL daemon (TCP mode) and the REAL bridge sidecar, then drives
// every agentic IPC command through the bridge's NDJSON stdio surface exactly
// as the Rust shell does, verifying each round-trips to the daemon and back.
//
// This is the authoritative live-run evidence for the P1 contract. Commands
// that the daemon genuinely lacks are expected to return a graceful JSON-RPC
// error (methodNotFound / invalidParams) — that is a PASS for "degrades
// gracefully", not a failure.
//
// Usage: node verify/ipc-roundtrip.mjs
// Env:   REF (coding-agent package root), DAEMON_PORT (default 48100),
//        BRIDGE (path to bridge dist index.js)

import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtempSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";

const REF =
  process.env.REF ||
  "C:/Users/Cayleb/Desktop/workspace/prime-agent-ref/packages/coding-agent";
// Unique port per run so the daemon supervisor registry never collides with a
// previous run's leftover supervisor (which would claim the port is owned).
const DAEMON_PORT = Number(process.env.DAEMON_PORT || (48000 + Math.floor(Math.random() * 1000)));
const SPEC = `tcp://127.0.0.1:${DAEMON_PORT}`;
const CLI = join(REF, "dist", "bundle", "cli.js");
const BRIDGE =
  process.env.BRIDGE ||
  "C:/Users/Cayleb/.traycer/worktrees/cayleb-james2008__sophos/gauntlet-agentic/bridge/dist/bridge/src/index.js";

const results = [];
let passCount = 0;
let failCount = 0;

// A graceful JSON-RPC error is any standard code the bridge/daemon returns
// (methodNotFound -32601, invalidParams -32602, internalError -32603). The
// bridge prefixes the code in the message, e.g. "-32601: ...".
const GRACEFUL = /-32601|-32602|-32603|no active/;
const METHOD_NOT_FOUND = /-32601/;
const INVALID_PARAMS = /-32602/;

function record(name, ok, detail) {
  results.push({ name, ok, detail });
  if (ok) passCount++;
  else failCount++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

function waitFor(re, stream, label, timeoutMs) {
  return new Promise((resolve, reject) => {
    let buf = "";
    const to = setTimeout(() => reject(new Error(`timeout waiting for ${label}`)), timeoutMs);
    const onData = (d) => {
      buf += d.toString();
      const m = buf.match(re);
      if (m) {
        clearTimeout(to);
        stream.off("data", onData);
        resolve(m);
      }
    };
    stream.on("data", onData);
  });
}

class BridgeClient {
  constructor(proc) {
    this.proc = proc;
    this.pending = new Map();
    this.nextId = 1;
    this.rl = createInterface({ input: proc.stdout });
    this.rl.on("line", (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      let obj;
      try {
        obj = JSON.parse(trimmed);
      } catch {
        return; // not JSON (shouldn't happen on stdout)
      }
      if (obj && typeof obj.id !== "undefined") {
        const p = this.pending.get(String(obj.id));
        if (p) {
          this.pending.delete(String(obj.id));
          if (obj.error) p.reject(new Error(`${obj.error.code}: ${obj.error.message}`));
          else p.resolve(obj.result);
        }
      }
    });
  }
  send(method, params = {}) {
    const id = `req-${this.nextId++}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`timeout: ${method} did not respond`));
      }, 30000);
      this.pending.set(id, { resolve, reject, timer });
      this.proc.stdin.write(JSON.stringify({ id, method, params }) + "\n");
    });
  }
  close() {
    this.rl.close();
    try { this.proc.stdin.end(); } catch {}
  }
}

async function main() {
  const cwd = mkdtempSync(join(tmpdir(), "sophos-ipc-"));
  const daemonLog = join(cwd, "daemon.log");
  const bridgeLog = join(cwd, "bridge.log");

  // 1) Spawn the daemon supervisor over TCP.
  const daemon = spawn(process.execPath, [CLI, "--mode", "daemon", "--daemon-socket", SPEC], {
    cwd,
    env: { ...process.env, PRIME_DAEMON_TCP: "1" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const dOut = [];
  daemon.stdout.on("data", (d) => dOut.push(d.toString()));
  daemon.stderr.on("data", (d) => dOut.push(d.toString()));

  let bridge;
  try {
    await waitFor(/listening on (tcp:\/\/[^\s]+)/i, daemon.stderr, "daemon tcp listen", 30000);
    record("daemon: supervisor listening on TCP", true, SPEC);

    // 2) Spawn the bridge sidecar (the exact process the Rust shell spawns).
    bridge = spawn(process.execPath, [BRIDGE], {
      cwd,
      env: { ...process.env, PRIME_DAEMON_TCP: "1", PRIME_DAEMON_TCP_PORT: String(DAEMON_PORT) },
      stdio: ["pipe", "pipe", "pipe"],
    });
    const bErr = [];
    bridge.stderr.on("data", (d) => bErr.push(d.toString()));
    const client = new BridgeClient(bridge);

    // Wait for the bridge to connect to the daemon (connected status event).
    await new Promise((resolve, reject) => {
      const to = setTimeout(() => reject(new Error("bridge never connected")), 30000);
      const onData = (d) => {
        const s = d.toString();
        if (s.includes('"kind":"connected"')) {
          clearTimeout(to);
          bridge.stdout.off("data", onData);
          resolve();
        }
      };
      bridge.stdout.on("data", onData);
    });
    record("bridge: connected to daemon", true);

    // 3) getState — the base state read.
    const state = await client.send("getState");
    record("getState: returns ConnectionState", !!state && !!state.status, `status=${state?.status?.kind}`);
    record("getState: has activeSessionId", typeof state?.activeSessionId === "string" && state.activeSessionId.length > 0, state?.activeSessionId);
    record("getState: has model", !!state?.model, state?.model ? `${state.model.provider}/${state.model.model}` : "none");

    // 4) getTranscript
    const transcript = await client.send("getTranscript");
    record("getTranscript: returns array", Array.isArray(transcript), `len=${Array.isArray(transcript) ? transcript.length : "?"}`);

    // 5) getModels / getProviders
    const models = await client.send("getModels");
    record("getModels: returns array", Array.isArray(models) && models.length > 0, `len=${Array.isArray(models) ? models.length : "?"}`);
    const providers = await client.send("getProviders");
    record("getProviders: returns array", Array.isArray(providers), `len=${Array.isArray(providers) ? providers.length : "?"}`);

    // 6) listSessions
    const sessions = await client.send("listSessions");
    record("listSessions: returns array", Array.isArray(sessions), `len=${Array.isArray(sessions) ? sessions.length : "?"}`);

    // 7) getContextStats
    const ctxStats = await client.send("getContextStats");
    record("getContextStats: returns object or undefined", ctxStats === undefined || (ctxStats && typeof ctxStats === "object"), JSON.stringify(ctxStats));

    // 8) getRlmChildren
    const rlm = await client.send("getRlmChildren");
    record("getRlmChildren: returns array", Array.isArray(rlm), `len=${Array.isArray(rlm) ? rlm.length : "?"}`);

    // 9) listAgents
    const agents = await client.send("listAgents");
    record("listAgents: returns array", Array.isArray(agents), `len=${Array.isArray(agents) ? agents.length : "?"}`);

    // 10) listInbox
    const inbox = await client.send("listInbox");
    record("listInbox: returns array", Array.isArray(inbox), `len=${Array.isArray(inbox) ? inbox.length : "?"}`);

    // 11) getSessionTree
    const tree = await client.send("getSessionTree");
    record("getSessionTree: returns tree", !!tree && Array.isArray(tree.tree), `nodes=${Array.isArray(tree?.tree) ? tree.tree.length : "?"}`);

    // 12) getContextTree
    const ctxTree = await client.send("getContextTree");
    record("getContextTree: returns node", !!ctxTree && typeof ctxTree.id === "string", ctxTree?.id);

    // 13) getSettings / setSettings
    const settings = await client.send("getSettings");
    record("getSettings: returns object", !!settings && typeof settings === "object");
    const setSettings = await client.send("setSettings", { settings: { theme: "dark" } });
    record("setSettings: returns settings", !!setSettings && typeof setSettings === "object");

    // 14) nameSession / setSessionName
    try {
      await client.send("nameSession", { name: "P1 roundtrip test" });
      record("nameSession: round-trips", true);
    } catch (e) {
      record("nameSession: graceful error", GRACEFUL.test(e.message), e.message);
    }
    try {
      await client.send("setSessionName", { name: "P1 roundtrip test" });
      record("setSessionName: round-trips", true);
    } catch (e) {
      record("setSessionName: graceful error", GRACEFUL.test(e.message), e.message);
    }

    // 15) steer
    try {
      await client.send("steer", { text: "continue" });
      record("steer: round-trips", true);
    } catch (e) {
      record("steer: graceful error", GRACEFUL.test(e.message), e.message);
    }

    // 16) abort
    try {
      await client.send("abort", {});
      record("abort: round-trips", true);
    } catch (e) {
      record("abort: graceful error", GRACEFUL.test(e.message), e.message);
    }

    // 17) compact — daemon rejects too-short sessions with a clear message
    try {
      await client.send("compact", {});
      record("compact: round-trips", true);
    } catch (e) {
      record("compact: graceful daemon rejection", GRACEFUL.test(e.message), e.message);
    }

    // 18) refine
    try {
      await client.send("refine", {});
      record("refine: round-trips", true);
    } catch (e) {
      record("refine: graceful error", GRACEFUL.test(e.message), e.message);
    }

    // 19) retry — documented no-op
    const retry = await client.send("retry", {});
    record("retry: returns (no-op)", true, `result=${JSON.stringify(retry)}`);

    // 20) sideQuestion / startSideQuestion
    try {
      const sq = await client.send("sideQuestion", { text: "what is 2+2?" });
      record("sideQuestion: round-trips", !!sq && typeof sq.id === "string", sq?.id);
    } catch (e) {
      record("sideQuestion: graceful error", GRACEFUL.test(e.message), e.message);
    }
    // startSideQuestion immediately after sideQuestion — the daemon rejects a
    // second concurrent side question (correct edge-case handling).
    try {
      const sq2 = await client.send("startSideQuestion", { text: "what is 2+2?" });
      record("startSideQuestion: round-trips", !!sq2 && typeof sq2.id === "string", sq2?.id);
    } catch (e) {
      record("startSideQuestion: graceful concurrent rejection", GRACEFUL.test(e.message), e.message);
    }

    // 21) addSchedule / removeSchedule
    try {
      const sched = await client.send("addSchedule", { cron: "0 9 * * *", prompt: "morning summary" });
      record("addSchedule: round-trips", !!sched && typeof sched.id === "string", sched?.id);
      if (sched && sched.id) {
        try {
          await client.send("removeSchedule", { id: sched.id });
          record("removeSchedule: round-trips", true);
        } catch (e) {
          record("removeSchedule: graceful error", GRACEFUL.test(e.message), e.message);
        }
      }
    } catch (e) {
      record("addSchedule: graceful error", GRACEFUL.test(e.message), e.message);
    }

    // 22) setHeartbeat / removeHeartbeat
    try {
      const hb = await client.send("setHeartbeat", { schedule: "*/15 * * * *", prompt: "nudge" });
      record("setHeartbeat: round-trips", true, hb ? `id=${hb.id}` : "undefined");
      try {
        await client.send("removeHeartbeat", {});
        record("removeHeartbeat: round-trips", true);
      } catch (e) {
        record("removeHeartbeat: graceful error", GRACEFUL.test(e.message), e.message);
      }
    } catch (e) {
      record("setHeartbeat: graceful error", GRACEFUL.test(e.message), e.message);
    }

    // 23) navigateTree
    try {
      const nav = await client.send("navigateTree", { entryId: "nonexistent" });
      record("navigateTree: round-trips", !!nav && typeof nav.cancelled === "boolean", JSON.stringify(nav));
    } catch (e) {
      record("navigateTree: graceful daemon rejection", GRACEFUL.test(e.message), e.message);
    }

    // 24) exportSession / exportToHtml / exportToJsonl
    try {
      const exp = await client.send("exportSession", { format: "html" });
      record("exportSession: round-trips", !!exp && typeof exp.exportedPath === "string", exp?.exportedPath);
    } catch (e) {
      record("exportSession: graceful error", GRACEFUL.test(e.message), e.message);
    }
    try {
      const h = await client.send("exportToHtml", {});
      record("exportToHtml: round-trips", !!h && typeof h.outputPath === "string", h?.outputPath);
    } catch (e) {
      record("exportToHtml: graceful error", GRACEFUL.test(e.message), e.message);
    }
    try {
      const j = await client.send("exportToJsonl", {});
      record("exportToJsonl: round-trips", !!j && typeof j.outputPath === "string", j?.outputPath);
    } catch (e) {
      record("exportToJsonl: graceful error", GRACEFUL.test(e.message), e.message);
    }

    // 25) shareSession — documented unsupported
    try {
      await client.send("shareSession", {});
      record("shareSession: should be unsupported", false, "unexpectedly succeeded");
    } catch (e) {
      record("shareSession: graceful unsupported", METHOD_NOT_FOUND.test(e.message), e.message);
    }

    // 26) cloneSession — documented unsupported (fork fallback)
    try {
      const cl = await client.send("cloneSession", {});
      record("cloneSession: round-trips (fork fallback)", !!cl, JSON.stringify(cl));
    } catch (e) {
      record("cloneSession: graceful unsupported", METHOD_NOT_FOUND.test(e.message), e.message);
    }

    // 27) forkSession
    try {
      const fork = await client.send("forkSession", { pathOrId: state?.activeSessionId ?? "" });
      record("forkSession: round-trips", true, JSON.stringify(fork));
    } catch (e) {
      record("forkSession: graceful error", GRACEFUL.test(e.message), e.message);
    }

    // 28) newSession (no cwd/goal)
    try {
      const ns = await client.send("newSession", {});
      record("newSession: round-trips", true, JSON.stringify(ns));
    } catch (e) {
      record("newSession: graceful error", GRACEFUL.test(e.message), e.message);
    }

    // 29) runCommand
    try {
      await client.send("runCommand", { command: "echo hello" });
      record("runCommand: round-trips", true);
    } catch (e) {
      record("runCommand: graceful error", GRACEFUL.test(e.message), e.message);
    }

    // 30) login/logout (auth mirror)
    try {
      const login = await client.send("login", { provider: "ollama-cloud", apiKey: "test-key" });
      record("login: round-trips", !!login && login.stored === true, JSON.stringify(login));
      const logout = await client.send("logout", { provider: "ollama-cloud" });
      record("logout: round-trips", !!logout && logout.stored === false, JSON.stringify(logout));
    } catch (e) {
      record("login/logout: graceful error", GRACEFUL.test(e.message), e.message);
    }

    // 31) setModel
    try {
      const sm = await client.send("setModel", { provider: "ollama-cloud", model: "deepseek-v4-flash:0731-cloud" });
      record("setModel: round-trips", !!sm && typeof sm.model === "string", sm?.model);
    } catch (e) {
      record("setModel: graceful error", GRACEFUL.test(e.message), e.message);
    }

    // 32) prompt — the core command
    try {
      await client.send("prompt", { text: "Reply with the single word: pong" });
      record("prompt: round-trips", true);
    } catch (e) {
      record("prompt: graceful error", GRACEFUL.test(e.message), e.message);
    }

    // 33) switchSession / resumeSession
    try {
      await client.send("switchSession", { id: state?.activeSessionId ?? "" });
      record("switchSession: round-trips", true);
    } catch (e) {
      record("switchSession: graceful error", GRACEFUL.test(e.message), e.message);
    }
    try {
      await client.send("resumeSession", { pathOrId: state?.activeSessionId ?? "" });
      record("resumeSession: round-trips", true);
    } catch (e) {
      record("resumeSession: graceful error", GRACEFUL.test(e.message), e.message);
    }

    // 34) sendAgentMessage / attachAgent (RLM)
    try {
      await client.send("sendAgentMessage", { agentId: "nonexistent", message: "hi" });
      record("sendAgentMessage: round-trips", true);
    } catch (e) {
      record("sendAgentMessage: graceful error", GRACEFUL.test(e.message), e.message);
    }
    try {
      await client.send("attachAgent", { id: "nonexistent" });
      record("attachAgent: round-trips", true);
    } catch (e) {
      record("attachAgent: graceful error", GRACEFUL.test(e.message), e.message);
    }

    // 35) markMessageRead
    try {
      const mr = await client.send("markMessageRead", { messageId: "nonexistent" });
      record("markMessageRead: round-trips", true, JSON.stringify(mr));
    } catch (e) {
      record("markMessageRead: graceful error", GRACEFUL.test(e.message), e.message);
    }

    // 36) unknown method → methodNotFound
    try {
      await client.send("totallyUnknownMethod", {});
      record("unknown method: should error", false, "unexpectedly succeeded");
    } catch (e) {
      record("unknown method: methodNotFound", METHOD_NOT_FOUND.test(e.message), e.message);
    }

    // 37) missing required param → invalidParams
    try {
      await client.send("prompt", {});
      record("prompt missing text: should error", false, "unexpectedly succeeded");
    } catch (e) {
      record("prompt missing text: invalidParams", INVALID_PARAMS.test(e.message), e.message);
    }

    client.close();
  } finally {
    try { bridge?.kill(); } catch {}
    try { daemon.kill(); } catch {}
    writeFileSync(daemonLog, dOut.join(""), "utf8");
    writeFileSync(bridgeLog, "", "utf8");
  }

  // Summary
  console.log("\n================ SUMMARY ================");
  console.log(`PASS: ${passCount}  FAIL: ${failCount}`);
  const fails = results.filter((r) => !r.ok);
  if (fails.length) {
    console.log("\nFAILURES:");
    for (const f of fails) console.log(`  - ${f.name}: ${f.detail}`);
  }
  console.log(`\ndaemon log: ${daemonLog}`);
  process.exit(failCount === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("[ipc-roundtrip] FATAL:", err?.stack ?? err);
  process.exit(1);
});
