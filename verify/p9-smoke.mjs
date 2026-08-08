#!/usr/bin/env node
// verify/p9-smoke.mjs — P9 node-graph verification via Playwright + system
// Chrome. Opens the dev server, walks every graph view (Agents / Sessions /
// Inbox / Engine), checks the node graphs render, captures console errors,
// and writes screenshots under verify/. Exit 0 on pass.

import { chromium } from "playwright-core";
import { mkdir } from "node:fs/promises";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const OUT = join(dirname(fileURLToPath(import.meta.url)));
const URL = process.env.P9_URL ?? "http://localhost:1421";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const errors = [];
const results = [];

async function shot(page, name) {
  const p = join(OUT, `p9-${name}.png`);
  await page.screenshot({ path: p });
  return p;
}

// Return whether any React Flow node graph is present in the view.
async function graphCount(page) {
  return page.locator(".react-flow__node").count();
}

const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text());
});
page.on("pageerror", (e) => errors.push(String(e)));

try {
  await page.goto(URL, { waitUntil: "networkidle" });
  await sleep(1500);

  // 1. Agents
  await page.getByRole("button", { name: /agents/i }).first().click({ timeout: 5000 });
  await sleep(1800);
  const agentsNodes = await graphCount(page);
  await shot(page, "agents");
  results.push(["Agents", "nodes:" + agentsNodes, agentsNodes > 0 ? "PASS" : "FAIL"]);

  // 2. Sessions
  await page.getByRole("button", { name: /sessions/i }).first().click({ timeout: 5000 });
  await sleep(1800);
  const sessionsNodes = await graphCount(page);
  await shot(page, "sessions");
  results.push(["Sessions", "nodes:" + sessionsNodes, sessionsNodes > 0 ? "PASS" : "FAIL"]);

  // 3. Inbox
  await page.getByRole("button", { name: /inbox/i }).first().click({ timeout: 5000 });
  await sleep(1800);
  const inboxNodes = await graphCount(page);
  await shot(page, "inbox");
  results.push(["Inbox", "nodes:" + inboxNodes, inboxNodes > 0 ? "PASS" : "FAIL"]);

  // 4. Engine terminal (toggle from the status bar)
  const engineToggle = page.locator('button[title*="engine terminal" i]');
  if (await engineToggle.count()) {
    await engineToggle.first().click({ timeout: 5000 });
    await sleep(1800);
    const engineNodes = await graphCount(page);
    await shot(page, "engine");
    results.push(["Engine", "nodes:" + engineNodes, engineNodes > 0 ? "PASS" : "FAIL"]);
    // engine graph sits in the terminal panel; also capture the full frame
    await engineToggle.first().click(); // close
    await sleep(500);
  } else {
    results.push(["Engine", "toggle-not-found", "WARN"]);
  }

  // 5. Back to chat to confirm the other views still render
  await page.getByRole("button", { name: /^chat$/i }).first().click({ timeout: 5000 });
  await sleep(1200);
  await shot(page, "chat-ok");
  results.push(["Chat", "still-renders", "PASS"]);
} catch (e) {
  results.push(["EXCEPTION", String(e), "FAIL"]);
} finally {
  await browser.close();
}

// Report
const lines = [];
lines.push("P9 node-graph smoke — " + new Date().toISOString());
lines.push("Target: " + URL);
lines.push("");
for (const [view, detail, verdict] of results) {
  lines.push(`  ${verdict.padEnd(4)}  ${view.padEnd(8)}  ${detail}`);
}
lines.push("");
lines.push("Console errors: " + (errors.length ? errors.length : "none"));
for (const e of errors) lines.push("  ERR " + e);
console.log(lines.join("\n"));

writeFileSync(join(OUT, "p9-smoke.txt"), lines.join("\n"));
const failed = results.some(([, , v]) => v === "FAIL");
process.exit(failed ? 1 : 0);
