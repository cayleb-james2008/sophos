// verify/visual/helpers.mjs — shared harness for the visual snapshot +
// regression suite. Reuses the browser/server plumbing from the e2e harness
// (verify/e2e/helpers.mjs) so there is exactly one source of truth for how we
// start the owned Vite server, launch the system Chrome, and navigate views.
import { mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// Re-export the shared e2e plumbing unchanged and bind it locally so
// settleView/captureView can call it.
import * as e2e from "../e2e/helpers.mjs";

export const {
  CHROME,
  REPO,
  HARD,
  freePort,
  startOwnedDevServer,
  stopOwnedDevServer,
  launch,
  gotoApp,
  navTo,
} = e2e;

const THIS = dirname(fileURLToPath(import.meta.url));

export const VISUAL_DIR = THIS;
export const BASELINE_DIR = join(THIS, "baselines");
export const DIFF_DIR = join(THIS, "diffs");
export const REPORT_PATH = join(THIS, "visual-report.json");
export const SUMMARY_PATH = join(THIS, "visual-summary.md");

mkdirSync(BASELINE_DIR, { recursive: true });
mkdirSync(DIFF_DIR, { recursive: true });

// The five main views, in sidebar order. `selector` is a Playwright selector
// that only resolves once the view's own content has rendered (scoped so it
// never matches the always-present sidebar nav labels).
export const VIEWS = [
  { id: "chat", label: "Chat", selector: "text=Conversation" },
  { id: "sessions", label: "Sessions", selector: 'h1:has-text("Session command center")' },
  { id: "agents", label: "Agents", selector: 'h1:has-text("Agent command center")' },
  { id: "inbox", label: "Inbox", selector: 'h1:has-text("Inbox")' },
  { id: "settings", label: "Settings", selector: "text=General preferences" },
];

/** Extra settle time after nav + network idle so view transitions/animations end. */
export const SETTLE_MS = 400;

/** Pixel-level per-channel color tolerance for pixelmatch (0..1). */
export const PIXEL_TOLERANCE = 0.1;

/** Max fraction of differing pixels for a view to pass (0.1%). */
export const MAX_DIFF_RATIO = 0.001;

/**
 * Dismiss the first-run onboarding dialog so the Chat view shows its real UI.
 * Safe to call repeatedly; no-op when the dialog is absent. Prefers "Skip for
 * now" (dismiss only) so no preview message is injected into the transcript.
 */
export async function dismissOnboarding(page) {
  const skip = page.locator('.pa-onboarding button:has-text("Skip for now")');
  if (await skip.count()) {
    await skip.first().click({ timeout: 10000 });
    await page.waitForTimeout(SETTLE_MS);
  }
}

/**
 * Navigate to a view and wait until its own content has rendered and any
 * transition has settled. Uses the same navTo from the e2e harness (which
 * parks the mouse on a neutral spot so tooltips don't interfere), then waits
 * for the view's key text selector and a fixed settle delay.
 */
export async function settleView(page, view) {
  await navTo(page, view.label);
  await page.waitForSelector(view.selector, { timeout: 30000 });
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(SETTLE_MS);
}

/**
 * Capture a full-page screenshot of a view to `outPath`. Returns the path and
 * the image dimensions { width, height }.
 */
export async function captureView(page, view, outPath) {
  await settleView(page, view);
  await page.screenshot({ path: outPath, fullPage: true });
  const dims = await page.evaluate(() => ({
    width: document.documentElement.scrollWidth || document.body.scrollWidth || 0,
    height: document.documentElement.scrollHeight || document.body.scrollHeight || 0,
  }));
  return { path: outPath, ...dims };
}
