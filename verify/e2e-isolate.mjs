#!/usr/bin/env node
/**
 * verify/e2e-isolate.mjs — run named e2e tests in ISOLATION, each in its own
 * freshly-launched browser, repeated N times.
 *
 * Why: the standard suite (e2e-browser.mjs) runs all 35 tests through ONE
 * shared page and only relaunches when the page is already closed. So a single
 * renderer crash can fail the test it happens during AND leave the next test
 * with a dead page. That produces "2 failures, different victims each run" —
 * which is indistinguishable, from the summary alone, from a real regression.
 *
 * This harness removes the shared-state variable entirely:
 *   - one fresh browser + page per test execution,
 *   - each named test repeated --repeat times,
 *   - a real logic regression fails deterministically (N/N),
 *   - a crash/flake fails intermittently (<N/N) and reports the error text.
 *
 * Usage:
 *   node verify/e2e-isolate.mjs --repeat 5 "Busy state" "Steering" "Follow-up"
 *   node verify/e2e-isolate.mjs --repeat 3 --all-agents
 */
import { execFileSync, spawn } from "node:child_process";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { createHarness, launch, gotoApp, APP_URL, REPO } from "./e2e/helpers.mjs";
import { views } from "./e2e/views.test.mjs";
import { flows } from "./e2e/flows.test.mjs";
import { edge } from "./e2e/edge.test.mjs";

const argv = process.argv.slice(2);
let repeat = 5;
const patterns = [];
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === "--repeat") { repeat = parseInt(argv[++i], 10) || 5; continue; }
  patterns.push(argv[i]);
}

const all = [...views, ...flows, ...edge];
const selected = patterns.length
  ? all.filter((t) => patterns.some((p) => t.name.toLowerCase().includes(p.toLowerCase())))
  : all;

if (!selected.length) {
  console.error("No tests matched. Available:");
  for (const t of all) console.error(`  [${t.section}] ${t.name}`);
  process.exit(2);
}

async function ensureDevServer() {
  try { const r = await fetch(APP_URL); if (r.ok) return null; } catch {}
  const viteBin = join(REPO, "node_modules", "vite", "bin", "vite.js");
  const proc = spawn(process.execPath, [viteBin], { stdio: "ignore", detached: true });
  for (let i = 0; i < 30; i++) {
    await sleep(1000);
    try { const r = await fetch(APP_URL); if (r.ok) return proc; } catch {}
  }
  throw new Error("dev server did not start on " + APP_URL);
}

function killStrayChrome() {
  try {
    const out = execFileSync("powershell", [
      "-NoProfile", "-Command",
      "Get-CimInstance Win32_Process -Filter 'Name=\"chrome.exe\"' | Where-Object { $_.CommandLine -match \"--headless\" -and $_.CommandLine -match \"playwright\" } | ForEach-Object { $_.ProcessId }",
    ], { encoding: "utf8", timeout: 8000 }).toString();
    for (const pid of out.split("\n").map((s) => parseInt(s.trim(), 10)).filter(Number.isFinite)) {
      try { execFileSync("taskkill", ["/F", "/T", "/PID", String(pid)], { stdio: "ignore", timeout: 5000 }); } catch {}
    }
  } catch {}
}

const CRASH_SIGNS = [
  "Target page, context or browser has been closed",
  "Target crashed",
  "browser has been closed",
  "Protocol error",
  "crashed",
];

async function main() {
  killStrayChrome();
  const devProc = await ensureDevServer();
  console.log(`Isolating ${selected.length} test(s), ${repeat}x each, fresh browser per run.\n`);

  const tally = new Map();

  try {
    for (const t of selected) {
      const key = `[${t.section}] ${t.name}`;
      tally.set(key, { pass: 0, fail: 0, errors: [] });
      for (let i = 1; i <= repeat; i++) {
        // Fresh browser + page for EVERY execution — no shared state at all.
        const { browser, page } = await launch();
        const harness = createHarness();
        page.on("console", (m) => { if (m.type() === "error") harness.recordError("console: " + m.text()); });
        page.on("pageerror", (e) => harness.recordError("pageerror: " + e.message));
        let ok = false, err = "";
        try {
          await gotoApp(page);
          ok = await harness.test(t.section, t.name, t.fn)(page);
          if (!ok) err = harness.results[harness.results.length - 1]?.error ?? "unknown";
        } catch (e) {
          ok = false; err = String(e?.message ?? e);
        } finally {
          try { await browser.close(); } catch {}
        }
        const rec = tally.get(key);
        if (ok) rec.pass++; else { rec.fail++; rec.errors.push(err); }
        process.stdout.write(`  ${key}  run ${i}/${repeat}: ${ok ? "PASS" : "FAIL"}\n`);
        if (!ok) process.stdout.write(`      → ${err.split("\n")[0].slice(0, 130)}\n`);
      }
    }
  } finally {
    if (devProc) { try { execFileSync("taskkill", ["/F", "/T", "/PID", String(devProc.pid)], { stdio: "ignore", timeout: 8000 }); } catch {} }
    killStrayChrome();
  }

  console.log("\n=== VERDICT ===");
  let anyDeterministic = false;
  for (const [key, r] of tally) {
    const crashy = r.errors.some((e) => CRASH_SIGNS.some((s) => e.includes(s)));
    let verdict;
    if (r.fail === 0) verdict = "STABLE (no failures in isolation)";
    else if (r.fail === repeat && !crashy) { verdict = "REAL REGRESSION (fails every run, not a crash)"; anyDeterministic = true; }
    else if (crashy) verdict = "CRASH/FLAKE (browser died; not a logic failure)";
    else { verdict = "INTERMITTENT (investigate)"; anyDeterministic = true; }
    console.log(`${key}\n   ${r.pass}/${repeat} passed — ${verdict}`);
    if (r.errors.length) console.log(`   first error: ${r.errors[0].split("\n")[0].slice(0, 150)}`);
  }
  process.exit(anyDeterministic ? 1 : 0);
}

main().catch((e) => { console.error("isolate crashed:", e); process.exit(2); });
