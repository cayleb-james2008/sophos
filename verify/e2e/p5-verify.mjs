// verify/e2e/p5-verify.mjs — P5 worker verification: session filter + windowed
// transcript. Drives the browser-demo app through an owned Vite server.
import { writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { gotoApp, launch, startOwnedDevServer, stopOwnedDevServer } from "./helpers.mjs";

const REPO = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const OUT = join(REPO, "verify", "e2e", "p5-report.json");

const results = [];
const consoleErrors = [];
const devServer = await startOwnedDevServer();
const record = (name, ok, detail) => results.push({ name, ok, detail });

let browser;
let page;
try {
  ({ browser, page } = await launch());
} catch (error) {
  await stopOwnedDevServer(devServer);
  throw error;
}
page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });
page.on("pageerror", (e) => consoleErrors.push(`pageerror: ${e.message}`));

try {
  await gotoApp(page, devServer.url);

  // The first-run dialog is an intentional mock-preview entry point. Dismiss it
  // through the real action before exercising the developer-only fixture.
  const startPreview = page.locator('button:has-text("Start a preview")');
  if (await startPreview.count() > 0) await startPreview.click();
  await page.waitForTimeout(250);

  // ---- 1. Session filter ----
  await page.click('nav button:has-text("Sessions")', { timeout: 10000 });
  await page.waitForTimeout(600);
  await page.mouse.move(900, 500);
  await page.waitForTimeout(150);

  // Baseline: all 3 demo sessions present.
  const allCount = await page.locator("text=Refactor auth module").count();
  record("filter-baseline-all-sessions", allCount > 0, `Refactor auth module visible: ${allCount}`);

  // Type a filter that matches only one session.
  await page.fill('input[aria-label="Filter sessions by name"]', "auth");
  await page.waitForTimeout(400);
  const authVisible = await page.locator("text=Refactor auth module").count();
  const configVisible = await page.locator("text=Migrate to new config schema").count();
  record("filter-narrows", authVisible > 0 && configVisible === 0, `auth=${authVisible}, config=${configVisible}`);

  // Clear button restores all.
  await page.click('button[aria-label="Clear session filter"]');
  await page.waitForTimeout(400);
  const configBack = await page.locator("text=Migrate to new config schema").count();
  record("filter-clear-restores", configBack > 0, `config back after clear: ${configBack}`);

  // Status filter: Active only.
  await page.selectOption('select[aria-label="Filter sessions by status"]', "active");
  await page.waitForTimeout(400);
  const activeVisible = await page.locator("text=Refactor auth module").count();
  const savedVisible = await page.locator("text=Migrate to new config schema").count();
  record("filter-status-active", activeVisible > 0 && savedVisible === 0, `active=${activeVisible}, saved=${savedVisible}`);

  // Reset status filter.
  await page.selectOption('select[aria-label="Filter sessions by status"]', "all");
  await page.waitForTimeout(300);

  // No-match filter shows the empty state.
  await page.fill('input[aria-label="Filter sessions by name"]', "zzz-no-such-session");
  await page.waitForTimeout(400);
  const noMatch = await page.locator("text=No sessions match your filter").count();
  record("filter-no-match-empty-state", noMatch > 0, `no-match empty state: ${noMatch}`);
  await page.click('button[aria-label="Clear session filter"]');
  await page.waitForTimeout(300);

  // ---- 2. Windowed transcript (500 messages) ----
  await page.click('nav button:has-text("Chat")', { timeout: 10000 });
  await page.waitForTimeout(400);
  await page.mouse.move(900, 500);
  await page.waitForTimeout(150);

  // Open the developer-only preview control, then time the render.
  await page.locator('summary:has-text("Developer preview")').click();
  const t0 = Date.now();
  await page.click('button:has-text("Load 500 messages")', { timeout: 10000 });
  // The windowed list mounts immediately — wait for any row to appear. The
  // list auto-sticks to the bottom, so the first rendered rows are near the
  // end of the transcript, not index 0.
  await page.waitForSelector('[data-index]', { timeout: 10000 });
  const renderMs = Date.now() - t0;
  record("perf-load-500-render", renderMs < 3000, `render 500 msgs in ${renderMs}ms`);
  const onboardingStillVisible = await page.locator(".pa-onboarding").count();
  const demoBoundary = await page.locator("text=Demo mode — engine not connected").count();
  record("perf-fixture-keeps-browser-demo-boundary", onboardingStillVisible === 0 && demoBoundary > 0, `onboarding=${onboardingStillVisible}, demo boundary=${demoBoundary}`);

  // Only a window of rows should be mounted (not all 500).
  const mountedRows = await page.evaluate(() => {
    return document.querySelectorAll('[data-index]').length;
  });
  record("perf-windowed-mount-count", mountedRows > 0 && mountedRows < 100, `mounted rows: ${mountedRows} (windowed, not 500)`);

  // Scroll to the bottom — the last assistant message (497) should render.
  await page.evaluate(() => {
    const scroller = [...document.querySelectorAll('div')].find((d) => getComputedStyle(d).overflowY === "auto" && d.scrollHeight > d.clientHeight * 2 && d.querySelector('[data-index]'));
    if (scroller) scroller.scrollTop = scroller.scrollHeight;
  });
  await page.waitForSelector("text=Here's the result for message 497", { timeout: 10000 });
  record("perf-scroll-to-bottom-renders-last", true, "last assistant message (497) rendered after scrolling to bottom");

  // Scroll to top and back to bottom — should not freeze and should re-stick.
  const scrollEl = await page.evaluate(() => {
    const el = document.querySelector('[data-index]')?.parentElement?.parentElement;
    return el ? { hasOverflow: getComputedStyle(el).overflowY === "auto" } : { hasOverflow: false };
  });
  record("perf-scroll-container", scrollEl.hasOverflow, `scroll container overflowY=auto: ${scrollEl.hasOverflow}`);

  // Scroll up (release stick), then back to bottom (re-engage).
  await page.evaluate(() => {
    const scroller = [...document.querySelectorAll('div')].find((d) => getComputedStyle(d).overflowY === "auto" && d.scrollHeight > d.clientHeight * 2 && d.querySelector('[data-index]'));
    if (scroller) scroller.scrollTop = 0;
  });
  await page.waitForTimeout(300);
  const atTop = await page.evaluate(() => {
    const scroller = [...document.querySelectorAll('div')].find((d) => getComputedStyle(d).overflowY === "auto" && d.scrollHeight > d.clientHeight * 2 && d.querySelector('[data-index]'));
    return scroller ? scroller.scrollTop : -1;
  });
  record("perf-scroll-up", atTop === 0, `scrollTop after scroll-up: ${atTop}`);

  // Scroll back to bottom.
  await page.evaluate(() => {
    const scroller = [...document.querySelectorAll('div')].find((d) => getComputedStyle(d).overflowY === "auto" && d.scrollHeight > d.clientHeight * 2 && d.querySelector('[data-index]'));
    if (scroller) scroller.scrollTop = scroller.scrollHeight;
  });
  await page.waitForTimeout(300);
  const nearBottom = await page.evaluate(() => {
    const scroller = [...document.querySelectorAll('div')].find((d) => getComputedStyle(d).overflowY === "auto" && d.scrollHeight > d.clientHeight * 2 && d.querySelector('[data-index]'));
    return scroller ? scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight : -1;
  });
  record("perf-scroll-bottom-restick", nearBottom >= 0 && nearBottom < 80, `distance to bottom after re-stick: ${nearBottom}`);

  // ---- 3. Empty state still shows when no messages (REAL browser check) ----
  // Open a fresh page with the demo seed neutralized (useChat's seed effect
  // sets messages to [] instead of demoSeed) so the transcript stays empty and
  // the EmptyChatHint must render.
  {
    const emptyPage = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await emptyPage.route("**/useChat.ts*", async (route) => {
      const resp = await route.fetch();
      let body = await resp.text();
      body = body.replace("setMessages(demoSeed());", "setMessages([]);");
      await route.fulfill({ response: resp, body });
    });
    await emptyPage.goto(devServer.url, { waitUntil: "networkidle", timeout: 30000 });
    await emptyPage.waitForSelector("text=Conversation", { timeout: 30000 });
    const emptyStartPreview = emptyPage.locator('button:has-text("Start a preview")');
    if (await emptyStartPreview.count() > 0) await emptyStartPreview.click();
    await emptyPage.waitForTimeout(1000);
    const emptyHint = await emptyPage.locator("text=Start a conversation").count();
    const prompt = await emptyPage.locator("text=$ sophos").count();
    record("empty-state-renders", emptyHint > 0 && prompt > 0, `EmptyChatHint 'Start a conversation'=${emptyHint}, '$ sophos'=${prompt}`);
    await emptyPage.close();
  }

  // ---- 4. Streaming still works after loading 500 (auto-stick) ----
  // Send a message; the simulated turn appends a streaming assistant message
  // and the view should stay pinned to the bottom.
  const ta = page.locator('textarea[aria-label="Message input"]');
  await ta.fill("verify stick after 500");
  await ta.press("Enter");
  await page.waitForSelector("text=Got it — you said", { timeout: 15000 });
  await page.waitForTimeout(500);
  const stickDist = await page.evaluate(() => {
    const scroller = [...document.querySelectorAll('div')].find((d) => getComputedStyle(d).overflowY === "auto" && d.scrollHeight > d.clientHeight * 2 && d.querySelector('[data-index]'));
    return scroller ? scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight : -1;
  });
  record("perf-stream-stick", stickDist >= 0 && stickDist < 80, `distance to bottom while streaming: ${stickDist}`);

  // ---- 5. Focus re-arm regression (HIGH fix) ----
  // After a transcript-search focus, the view must NOT snap back to the focused
  // message on subsequent streaming / new messages / scrolling — auto-stick must
  // work again. Drive the real ⌘K palette: open it, run "Search transcript…",
  // search for a mid-transcript message, and jump to it.
  await page.keyboard.press("Control+k");
  await page.waitForSelector('input[placeholder="Type a command or search…"]', { timeout: 5000 });
  await page.fill('input[placeholder="Type a command or search…"]', "search transcript");
  await page.waitForTimeout(300);
  await page.keyboard.press("Enter"); // run "Search transcript…"
  await page.waitForSelector('input[aria-label="Search transcript"]', { timeout: 5000 });
  await page.fill('input[aria-label="Search transcript"]', "message 100");
  await page.waitForTimeout(400);
  await page.keyboard.press("Enter"); // jump to the first match
  // The palette navigates to chat and the view should scroll to message 100
  // (a user message — assert the row with data-index 100 is rendered).
  await page.waitForFunction(
    () => [...document.querySelectorAll('[data-index]')].some((r) => Number(r.getAttribute('data-index')) === 100),
    { timeout: 10000 },
  );
  const focused = await page.evaluate(() => {
    const scroller = [...document.querySelectorAll('div')].find((d) => getComputedStyle(d).overflowY === "auto" && d.scrollHeight > d.clientHeight * 2 && d.querySelector('[data-index]'));
    return scroller ? scroller.scrollTop : -1;
  });
  record("focus-scrolls-to-message", focused > 0, `scrolled to focused message (scrollTop=${focused})`);

  // Re-engage the auto-stick by scrolling to the bottom, then send a new
  // message — the view must STAY pinned to the bottom (auto-stick works again),
  // NOT snap back to the focused message 100.
  await page.evaluate(() => {
    const scroller = [...document.querySelectorAll('div')].find((d) => getComputedStyle(d).overflowY === "auto" && d.scrollHeight > d.clientHeight * 2 && d.querySelector('[data-index]'));
    if (scroller) scroller.scrollTop = scroller.scrollHeight;
  });
  await page.waitForTimeout(500);
  await ta.fill("regression: focus must not re-arm");
  await ta.press("Enter");
  await page.waitForSelector("text=Got it — you said", { timeout: 15000 });
  await page.waitForTimeout(600);
  const afterStream = await page.evaluate(() => {
    const scroller = [...document.querySelectorAll('div')].find((d) => getComputedStyle(d).overflowY === "auto" && d.scrollHeight > d.clientHeight * 2 && d.querySelector('[data-index]'));
    return scroller ? scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight : -1;
  });
  record("focus-no-rearm-stream", afterStream >= 0 && afterStream < 80, `distance to bottom after focus + stream: ${afterStream} (auto-stick holds, not snapped to msg 100)`);

  // Manual scroll up must also stay (not snap back to the focused message).
  await page.evaluate(() => {
    const scroller = [...document.querySelectorAll('div')].find((d) => getComputedStyle(d).overflowY === "auto" && d.scrollHeight > d.clientHeight * 2 && d.querySelector('[data-index]'));
    if (scroller) scroller.scrollTop = 0;
  });
  await page.waitForTimeout(400);
  const afterScrollUp = await page.evaluate(() => {
    const scroller = [...document.querySelectorAll('div')].find((d) => getComputedStyle(d).overflowY === "auto" && d.scrollHeight > d.clientHeight * 2 && d.querySelector('[data-index]'));
    return scroller ? scroller.scrollTop : -1;
  });
  record("focus-no-rearm-scroll", afterScrollUp === 0, `scrollTop after manual scroll-up post-focus: ${afterScrollUp} (stays, not snapped back)`);

  // ---- 6. No console errors ----
  record("no-console-errors", consoleErrors.length === 0, consoleErrors.length ? consoleErrors.join(" | ") : "clean");

  await page.screenshot({ path: join(REPO, "verify", "e2e", "p5-filter.png") });
} catch (e) {
  record("fatal", false, e.message);
} finally {
  await browser.close();
  await stopOwnedDevServer(devServer);
}

const passed = results.filter((r) => r.ok).length;
const report = {
  suite: "p5-worker-verify",
  mode: "browser-demo (MockIpcClient)",
  results,
  consoleErrors,
  summary: { total: results.length, passed, failed: results.length - passed, overall: results.every((r) => r.ok) ? "PASS" : "FAIL" },
};
writeFileSync(OUT, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
