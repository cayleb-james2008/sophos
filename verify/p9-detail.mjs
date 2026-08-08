#!/usr/bin/env node
// verify/p9-detail.mjs — scoped DOM verification of the four node-graph views.
// Each check is scoped to its own pane (the hidden engine graph sits in the DOM
// and would otherwise inflate global counts). Verifies nodes render, edges
// render, and the graceful empty/error states show when the mock has no data.
// Exit 0 on pass.

import { chromium } from "playwright-core";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const OUT = join(dirname(fileURLToPath(import.meta.url)));
const URL = process.env.P9_URL ?? "http://localhost:1421";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const lines = [];
const fails = [];
const log = (s) => lines.push(s);

const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1480, height: 920 } });
const errors = [];
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
page.on("pageerror", (e) => errors.push(String(e)));

try {
  await page.goto(URL, { waitUntil: "networkidle" });
  await sleep(1500);

  // ---- Agents ----
  await page.getByRole("button", { name: /agents/i }).first().click();
  await sleep(2200);
  const pane = ".ag-graphwrap";
  const anodes = await page.locator(`${pane} .react-flow__node`).count();
  const aedges = await page.locator(`${pane} .react-flow__edge`).count();
  const aAnimated = await page.locator(`${pane} .react-flow__edge-path.pg-animated`).count();
  const aPulses = await page.locator(`${pane} .react-flow__edges circle`).count();
  const aInspector = await page.locator(".ag-inspectorwrap .ag-detail").count();
  const aLegend = await page.locator(`${pane} .pg-legend`).count();
  log(`[Agents] nodes=${anodes} edges=${aedges} animated=${aAnimated} pulses=${aPulses} inspector=${aInspector} legend=${aLegend}`);
  if (anodes < 3) fails.push("Agents: expected >=3 nodes (operator+daemon+rlm)");
  if (aedges < 2) fails.push("Agents: expected >=2 edges");
  if (aAnimated < 1) fails.push("Agents: expected animated heartbeat edges");
  if (!aInspector) fails.push("Agents: inspector pane missing");

  // ---- Sessions ----
  await page.getByRole("button", { name: /sessions/i }).first().click();
  await sleep(2400);
  const spane = ".sessions__graphwrap";
  const snodes = await page.locator(`${spane} .react-flow__node`).count();
  const sedges = await page.locator(`${spane} .react-flow__edge`).count();
  const rings = await page.locator(`${spane} .pg-ring`).count();
  const sDetail = await page.locator(".sessions__detail").count();
  log(`[Sessions] nodes=${snodes} edges=${sedges} rings=${rings} detail=${sDetail}`);
  if (snodes < 3) fails.push("Sessions: expected >=3 nodes");
  if (sedges < 1) fails.push("Sessions: expected >=1 edge");
  if (!sDetail) fails.push("Sessions: detail pane missing");

  // ---- Inbox ----
  await page.getByRole("button", { name: /inbox/i }).first().click();
  await sleep(2200);
  const ipane = ".inbox__graphwrap";
  const iNodes = await page.locator(`${ipane} .react-flow__node`).count();
  const iBlank = await page.locator(`${ipane} .inbox__graphblank`).count();
  const iChips = await page.locator(".inbox__chip").count();
  log(`[Inbox] flowNodes=${iNodes} blankState=${iBlank} chips=${iChips}`);
  // Mock surfaces empty agents + inbox -> graceful state expected. Flow graph
  // renders when real data is present (same shared graph primitives).
  if (!iBlank && iNodes === 0) fails.push("Inbox: expected graceful empty state in preview");
  if (errors.length && !errors.every((e) => e.includes("404"))) fails.push("Inbox: console error");

  // ---- Engine ----
  const engToggle = page.locator('button[title*="engine terminal" i]');
  if (!(await engToggle.count())) { fails.push("Engine: toggle missing"); }
  else {
    await engToggle.first().click();
    await sleep(2200);
    const eng = page.locator(".react-flow").last();
    const eNodes = await eng.locator(".react-flow__node").count();
    const eEdgesHtml = await eng.locator(".react-flow__edges").evaluate((e) => e.innerHTML.length);
    const eEdges = eEdgesHtml > 0 ? await eng.locator(".react-flow__edge").count() : 0;
    const previewNote = await page.getByText(/browser preview/i).count();
    log(`[Engine] nodes=${eNodes} edges=${eEdges} previewNote=${previewNote}`);
    if (eNodes < 2) fails.push("Engine: process graph too small");
    if (eEdges < 1) fails.push("Engine: process graph edges missing");
  }

  // ---- Chat ----
  await page.getByRole("button", { name: /^chat$/i }).first().click();
  await sleep(1200);
  log(`[Chat] main=${await page.locator("main").count()}`);

} catch (e) {
  fails.push("EXCEPTION: " + e);
} finally {
  await browser.close();
}

log("");
const realErrors = errors.filter((e) => !e.includes("404"));
log("Console errors: " + (realErrors.length ? realErrors.length : "none") + (errors.length ? ` (${errors.length} total, rest are favicon 404)` : ""));
realErrors.forEach((e) => log("  ERR " + e));
log(fails.length ? "\nFAILED:\n  " + fails.join("\n  ") : "\nALL CHECKS PASSED");

const out = lines.join("\n");
console.log(out);
writeFileSync(join(OUT, "p9-detail.txt"), out);
process.exit(fails.length ? 1 : 0);
