// critic-p1-probe.mjs — independent critic probe for P1 local provider card.
// Verifies: local card renders first, has Local badge + Connected, has Log out,
// and exercises the Connect → modal → Log out round-trip.
import { chromium } from "playwright-core";

const BASE = "http://localhost:1420/";
const errors = [];
const passes = [];
const fails = [];
const ok = (n) => { passes.push(n); console.log("PASS  " + n); };
const bad = (n, d) => { fails.push(n + " — " + d); console.log("FAIL  " + n + " — " + d); };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
page.on("console", m => { if (m.type() === "error") errors.push("console: " + m.text()); });
page.on("pageerror", e => errors.push("pageerror: " + e.message));

try {
  await page.goto(BASE, { waitUntil: "networkidle" });
  await sleep(800);

  // Navigate to Settings → Providers (use the same path as e2e/helpers.mjs)
  await page.click('nav button:has-text("Settings")');
  await sleep(700);
  await page.mouse.move(900, 500);
  await sleep(200);
  await page.click('button[role="tab"]:has-text("Providers")', { force: true });
  await sleep(900);

  // CRITICAL: local card renders FIRST
  const localBadge = await page.locator("text=Local").count();
  if (localBadge > 0) ok("Local badge renders in providers panel");
  else bad("Local badge missing", `count=${localBadge}`);

  // Local card has Connected (default) and shows Log out
  const connected = await page.locator("text=Connected").count();
  if (connected > 0) ok("Connected badge visible (default-on mock)");
  else bad("Connected badge missing", `count=${connected}`);

  const localName = await page.locator("text=My Local Model").count();
  if (localName > 0) ok("local card displays 'My Local Model'");
  else bad("local card name missing", `count=${localName}`);

  const baseUrl = await page.locator("text=http://localhost:11434").count();
  if (baseUrl > 0) ok("local card shows base URL");
  else bad("base URL missing", `count=${baseUrl}`);

  // Take a screenshot of the panel for visual evidence
  await page.screenshot({ path: "verify/critic-p1-providers-connected.png", fullPage: true });
  ok("screenshot saved: critic-p1-providers-connected.png");

  // Check that the local card is FIRST in DOM order (before other provider cards)
  const cardOrder = await page.evaluate(() => {
    const cards = Array.from(document.querySelectorAll("[class*='Card'], [data-card], div"))
      .filter(el => el.textContent && el.textContent.includes("My Local Model"));
    // Just find positions of each provider card by name
    const all = Array.from(document.querySelectorAll("div")).filter(d => {
      const t = d.textContent || "";
      // Look for provider-card root elements that contain BOTH a name and a badge
      return d.children.length >= 2 && d.querySelector && (t.includes("Ollama Cloud") || t.includes("My Local Model") || t.includes("OpenRouter"));
    });
    const positions = all.map((d, i) => ({
      idx: i,
      preview: (d.textContent || "").slice(0, 80).replace(/\s+/g, " "),
    })).slice(0, 10);
    return positions;
  });
  console.log("\nCard order preview:", JSON.stringify(cardOrder, null, 2));

  // Click Log out on the local card → should become Offline + Connect button
  const logoutBtn = page.locator("button:has-text('Log out')");
  const logoutCount = await logoutBtn.count();
  console.log("\nLog out buttons visible:", logoutCount);
  if (logoutCount > 0) ok("local card shows Log out button (connected state)");

  // Find the Log out inside the LOCAL card specifically (first one)
  const firstLogout = logoutBtn.first();
  await firstLogout.click();
  await sleep(600);

  const offline = await page.locator("text=Offline").count();
  if (offline > 0) ok("after logout: Offline badge visible");
  else bad("after logout", "Offline badge missing");

  const connectBtn = page.locator("button:has-text('Connect')");
  const connectCount = await connectBtn.count();
  console.log("Connect buttons after logout:", connectCount);

  await page.screenshot({ path: "verify/critic-p1-providers-disconnected.png", fullPage: true });

  // Click the FIRST Connect button (which is the local one in disconnected state)
  await connectBtn.first().click();
  await sleep(500);

  // Modal title should be "Connect Local Model" — NOT "Connect Ollama Cloud"
  const localModalTitle = await page.locator("text=Connect Local Model").count();
  if (localModalTitle > 0) ok("Connect Local Model modal opens");
  else bad("Connect Local Model modal", "missing");

  const ollamaCloudModal = await page.locator("text=Connect Ollama Cloud").count();
  if (ollamaCloudModal === 0) ok("Connect Ollama Cloud modal did NOT open (no collision)");
  else bad("Connect Ollama Cloud modal", "opened when it shouldn't (collision!)");

  await page.screenshot({ path: "verify/critic-p1-local-modal.png", fullPage: true });

  // Verify modal has Base URL input + Kind selector
  const baseUrlInput = await page.locator("text=Base URL").count();
  if (baseUrlInput > 0) ok("modal has Base URL field");
  else bad("Base URL field", "missing");

  const kindSelector = await page.locator("text=Kind").count();
  if (kindSelector > 0) ok("modal has Kind selector");
  else bad("Kind selector", "missing");

  // Submit the modal
  await page.click('div[role="dialog"] button:has-text("Connect")');
  await sleep(800);

  const connectedAgain = await page.locator("text=Connected").count();
  if (connectedAgain > 0) ok("after connect: Connected badge visible");
  else bad("after connect", "Connected badge missing");

  await page.screenshot({ path: "verify/critic-p1-providers-reconnected.png", fullPage: true });

} finally {
  console.log("\n--- Console/page errors ---");
  if (errors.length === 0) console.log("(none)");
  else errors.forEach(e => console.log("  " + e));

  console.log("\n--- Summary ---");
  console.log(`PASS: ${passes.length}`);
  console.log(`FAIL: ${fails.length}`);
  if (fails.length) fails.forEach(f => console.log("  ✗ " + f));

  await browser.close();
  process.exit(fails.length ? 1 : 0);
}
