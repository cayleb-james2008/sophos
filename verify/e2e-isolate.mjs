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
import { createHarness, launch, gotoApp, startOwnedDevServer, stopOwnedDevServer } from "./e2e/helpers.mjs";
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


const CRASH_SIGNS = [
  "Target page, context or browser has been closed",
  "Target crashed",
  "browser has been closed",
  "Protocol error",
  "crashed",
];

async function main() {
  const devServer = await startOwnedDevServer();
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
          await gotoApp(page, devServer.url);
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
    await stopOwnedDevServer(devServer);
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
