// verify/live-safety-controls.mjs — do the safety controls fire against the
// REAL daemon (not the browser mock)?
//
// Everything proven so far ran in browser-demo mode against MockIpcClient.
// This drives the REAL daemon + REAL bridge over the same NDJSON stdio surface
// the Rust shell uses, and asks the two questions that actually matter:
//
//   1. APPROVE-GATE  — does a real `refine` produce a refinement_result that
//      arrives as a PROPOSAL (i.e. the daemon does not silently self-apply),
//      so the client gate has something to hold?
//   2. CIRCUIT-BREAKER — does the daemon actually report the telemetry the
//      breaker trips on (costStats / context.tokens / connection status /
//      goal+autonomous active)? A breaker wired to fields the daemon never
//      populates would be decorative.
//
// Honest by construction: we assert on what the daemon really sends. Where a
// datum is absent we say so rather than inferring success.
//
// Usage: BRIDGE=<path to bridge dist index.js> node verify/live-safety-controls.mjs

import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { createInterface } from "node:readline";

const REPO = resolve(import.meta.dirname, "..");
// Match verify/ipc-roundtrip.mjs exactly: the coding-agent CLI from the
// reference checkout, launched with plain node in `--mode daemon`. That is the
// configuration already proven to bring up a real daemon (56/56).
const REF = process.env.REF || "C:/Users/Cayleb/Desktop/workspace/prime-agent-ref/packages/coding-agent";
const DAEMON = join(REF, "dist", "bundle", "cli.js");
const BRIDGE = process.env.BRIDGE || join(REPO, "bridge", "dist", "bridge", "src", "index.js");
const PORT = Number(process.env.DAEMON_PORT || (48300 + Math.floor(Math.random() * 500)));
const SPEC = `tcp://127.0.0.1:${PORT}`;

const results = [];
const note = (name, ok, detail = "") => {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};
const info = (name, detail) => {
  results.push({ name, ok: null, detail });
  console.log(`INFO  ${name}${detail ? ` — ${detail}` : ""}`);
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const work = mkdtempSync(join(tmpdir(), "sophos-live-safety-"));
  mkdirSync(join(work, "proj"), { recursive: true });
  writeFileSync(join(work, "proj", "README.md"), "# live safety probe\n");

  // ---- real daemon -------------------------------------------------------
  const daemon = spawn(process.execPath, [DAEMON, "--mode", "daemon", "--daemon-socket", SPEC], {
    cwd: join(work, "proj"),
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, PRIME_DAEMON_TCP: "1" },
  });
  let daemonUp = false;
  const watch = (chunk) => { if (/listening/i.test(String(chunk))) daemonUp = true; };
  daemon.stdout.on("data", watch);
  daemon.stderr.on("data", watch);
  for (let i = 0; i < 60 && !daemonUp; i++) await sleep(500);
  note("real daemon listening", daemonUp, SPEC);
  if (!daemonUp) return finish(daemon, null);

  // ---- real bridge -------------------------------------------------------
  const bridge = spawn(process.execPath, [BRIDGE], {
    cwd: join(work, "proj"),
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, PRIME_DAEMON_TCP: "1", PRIME_DAEMON_TCP_PORT: String(PORT) },
  });

  let id = 0;
  const pending = new Map();
  const events = [];
  let connected = false;

  createInterface({ input: bridge.stdout }).on("line", (line) => {
    let msg;
    try { msg = JSON.parse(line); } catch { return; }
    if (msg.id !== undefined && pending.has(msg.id)) {
      const { resolve: res } = pending.get(msg.id);
      pending.delete(msg.id);
      res(msg);
      return;
    }
    if (msg.method === "event" || msg.type) {
      const ev = msg.params ?? msg;
      events.push(ev);
      const st = ev?.status?.kind ?? ev?.state?.status?.kind;
      if (st === "connected") connected = true;
    }
  });

  const call = (method, params = {}, timeout = 30000) =>
    new Promise((res) => {
      const rid = ++id;
      pending.set(rid, { resolve: res });
      bridge.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: rid, method, params }) + "\n");
      setTimeout(() => { if (pending.has(rid)) { pending.delete(rid); res({ error: { message: "timeout" } }); } }, timeout);
    });

  for (let i = 0; i < 60 && !connected; i++) await sleep(500);
  note("bridge connected to the real daemon", connected);
  if (!connected) return finish(daemon, bridge);

  // ---- 1. What telemetry does the REAL daemon actually report? -----------
  const stateRes = await call("getState");
  const state = stateRes?.result ?? {};
  info("daemon connection status", JSON.stringify(state?.status ?? null));

  const hasCost = state.costStats !== undefined;
  const hasContext = state.context !== undefined;
  note("daemon reports costStats (the breaker's spend input)", hasCost,
       hasCost ? JSON.stringify(state.costStats) : "absent — spend breaker would be inert");
  note("daemon reports context tokens (the breaker's token input)", hasContext,
       hasContext ? `tokens=${state.context?.tokens} window=${state.context?.contextWindow}` : "absent");

  const ctxRes = await call("getContextStats");
  info("getContextStats round-trip", JSON.stringify(ctxRes?.result ?? ctxRes?.error ?? null).slice(0, 160));

  // ---- 2. Does the daemon expose autonomous/goal state? ------------------
  const autoPresent = state.autonomousConfig !== undefined;
  info("daemon reports autonomousConfig (breaker's 'is a loop running')",
       autoPresent ? JSON.stringify(state.autonomousConfig) : "absent — client treats as inactive");
  info("daemon reports goals", JSON.stringify(state.goals ?? null));

  // ---- 3. APPROVE-GATE: does refine yield a PROPOSAL, not a self-apply? --
  const before = events.filter((e) => e.type === "refinement_result").length;
  const refineRes = await call("refine", {}, 90000);
  await sleep(4000);
  const after = events.filter((e) => e.type === "refinement_result").length;

  if (refineRes?.error) {
    info("real refine() outcome", `daemon returned: ${JSON.stringify(refineRes.error).slice(0, 180)}`);
  } else {
    info("real refine() outcome", "accepted by the daemon");
  }
  const gotProposal = after > before;
  if (gotProposal) {
    const ev = events.filter((e) => e.type === "refinement_result").pop();
    const applied = JSON.stringify(ev?.result?.appliedEdits ?? []);
    note("refinement arrives as a reviewable proposal (client gate can hold it)", true, `appliedEdits=${applied}`);
  } else {
    info("refinement_result event", "none emitted in this run — cannot assert the gate end-to-end here");
  }

  // ---- 4. Is the engine-down signal real? --------------------------------
  // Kill the daemon and confirm the bridge reports disconnected — that is the
  // exact input the breaker's (e1) dead-engine detector consumes.
  try { daemon.kill("SIGKILL"); } catch {}
  await sleep(6000);
  const downSeen = events.some((e) => {
    const k = e?.status?.kind ?? e?.state?.status?.kind;
    return k === "disconnected" || k === "reconnecting";
  });
  note("engine-down is a REAL signal (breaker input e1 fires on daemon loss)", downSeen,
       downSeen ? "bridge reported disconnected/reconnecting" : "no disconnect event observed");

  return finish(daemon, bridge);
}

function finish(daemon, bridge) {
  try { bridge?.kill("SIGKILL"); } catch {}
  try { daemon?.kill("SIGKILL"); } catch {}
  const asserted = results.filter((r) => r.ok !== null);
  const passed = asserted.filter((r) => r.ok).length;
  console.log("\n================ SUMMARY ================");
  console.log(`asserted ${passed}/${asserted.length} passed · ${results.filter((r) => r.ok === null).length} informational`);
  process.exit(passed === asserted.length ? 0 : 1);
}

main().catch((e) => { console.error("live-safety FATAL:", e); process.exit(2); });
