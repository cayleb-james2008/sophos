// verify/e2e/edge.test.mjs — edge-case coverage: empty/invalid input, busy
// state, transient indicators, empty states, engine-disconnected (demo) state,
// and a whole-app console-error sweep.
import { navTo, sendMessage, waitBusy, waitIdle } from "./helpers.mjs";
import { patchListSessionsReject, restoreMock } from "./mock-patch.mjs";

export const edge = [
  {
    section: "Edge",
    name: "Empty / whitespace input disables send",
    fn: async ({ page, shot, expect }) => {
      await navTo(page, "Chat");
      const send = page.locator('button[aria-label="Send message"]');
      await expect(await send.isDisabled(), "send should be disabled on empty input");
      const ta = page.locator('textarea[aria-label="Message input"]');
      await ta.fill("   ");
      await expect(await send.isDisabled(), "send should be disabled on whitespace-only input");
      await shot("edge-empty-input");
      return true;
    },
  },
  {
    section: "Edge",
    name: "Escape clears composer text when idle",
    fn: async ({ page, shot, expect }) => {
      await navTo(page, "Chat");
      const ta = page.locator('textarea[aria-label="Message input"]');
      await ta.fill("some draft text");
      await expect(await ta.inputValue() === "some draft text", "draft not entered");
      await ta.press("Escape");
      await expect(await ta.inputValue() === "", "Escape did not clear text");
      await shot("edge-escape-clear");
      return true;
    },
  },
  {
    section: "Edge",
    name: "@ file-reference hint popover appears",
    fn: async ({ page, shot, expect }) => {
      await navTo(page, "Chat");
      const ta = page.locator('textarea[aria-label="Message input"]');
      await ta.fill("check @file");
      await expect(await page.locator("text=reference a project file").count() > 0, "file hint popover missing");
      await shot("edge-file-hint");
      await ta.fill("");
      return true;
    },
  },
  {
    section: "Edge",
    name: "Shell command (!cmd) shows shell notice",
    fn: async ({ page, shot, expect }) => {
      await navTo(page, "Chat");
      await sendMessage(page, "!ls");
      await expect(await page.locator("text=shell").count() > 0, "shell notice missing");
      await expect(await page.locator("text=$ ls").count() > 0, "shell command text missing");
      await shot("edge-shell");
      return true;
    },
  },
  {
    section: "Edge",
    name: "Busy state shows streaming indicator + stop control",
    fn: async ({ page, shot, expect }) => {
      await navTo(page, "Chat");
      await sendMessage(page, "busy check");
      await waitBusy(page);
      await expect(await page.locator("text=streaming…").count() > 0, "streaming indicator missing");
      await expect(await page.locator('button[aria-label="Stop generating"]').count() === 1, "stop control missing while busy");
      await shot("edge-busy");
      await waitIdle(page, 20000);
      return true;
    },
  },
  {
    section: "Edge",
    name: "Engine-disconnected (demo) banner present in browser mode",
    fn: async ({ page, shot, expect }) => {
      await navTo(page, "Chat");
      await expect(await page.locator("text=Demo mode — engine not connected").count() > 0, "demo/disconnected banner missing");
      await shot("edge-demo-banner");
      return true;
    },
  },
  {
    section: "Edge",
    name: "Agents view renders RLM children fleet (non-empty)",
    fn: async ({ page, shot, expect }) => {
      await navTo(page, "Agents");
      // Mock surfaces 2 RLM children — the fleet graph is populated, not empty.
      await expect(await page.locator("text=Reviewing endpoint contracts").count() > 0, "RLM child api-reviewer missing");
      await expect(await page.locator("text=Awaiting next batch").count() > 0, "RLM child test-runner missing");
      await shot("edge-agents-fleet");
      return true;
    },
  },
  {
    section: "Edge",
    name: "Inbox view empty state (no relay traffic)",
    fn: async ({ page, shot, expect }) => {
      await navTo(page, "Inbox");
      await expect(await page.locator("text=No relay traffic yet").count() > 0, "inbox empty state missing");
      await shot("edge-inbox-empty");
      return true;
    },
  },
  {
    section: "Edge",
    name: "Error handling: IPC rejection shows error UI + Retry recovers",
    fn: async ({ page, shot, expect }) => {
      // Make listSessions reject so the Sessions view hits its error path.
      await patchListSessionsReject(page);
      try {
        await navTo(page, "Sessions");
        await page.waitForSelector("text=Sessions unavailable", { timeout: 10000 });
        await expect(await page.locator("text=Try again").count() > 0, "Retry button missing in error state");
        await shot("edge-error-state");
        // Restore the mock and click Retry — the view should recover.
        await restoreMock(page, ["listSessions"]);
        await page.click('button:has-text("Try again")');
        await page.waitForSelector("text=Refactor auth module", { timeout: 10000 });
        await expect(await page.locator("text=Sessions unavailable").count() === 0, "error state did not clear after Retry");
        await shot("edge-error-recovered");
        return true;
      } finally {
        await restoreMock(page, ["listSessions"]);
      }
    },
  },
  {
    section: "Edge",
    name: "Empty transcript state in session detail",
    fn: async ({ page, shot, expect }) => {
      await navTo(page, "Sessions");
      await page.locator("text=Refactor auth module").first().click();
      await page.waitForSelector("text=Context usage", { timeout: 10000 });
      // The mock returns an empty transcript — the detail shows the empty state.
      await expect(await page.locator("text=No transcript available").count() > 0, "empty transcript state missing");
      await shot("edge-empty-transcript");
      return true;
    },
  },
  {
    section: "Edge",
    name: "No console/page errors across all views",
    fn: async ({ page, shot, expect }) => {
      // Sweep every view and collect errors.
      const errors = [];
      const onErr = (m) => errors.push(m.text());
      page.on("console", (m) => { if (m.type() === "error") onErr(m); });
      page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
      for (const v of ["Chat", "Sessions", "Agents", "Inbox", "Settings"]) {
        await navTo(page, v);
        await page.waitForTimeout(400);
      }
      // Settings sub-tabs.
      await page.click('button[role="tab"]:has-text("Providers")');
      await page.waitForTimeout(300);
      await page.click('button[role="tab"]:has-text("Advanced")');
      await page.waitForTimeout(300);
      await page.click('button[role="tab"]:has-text("Long-running")');
      await page.waitForTimeout(300);
      await shot("edge-error-sweep");
      // Filter out benign React dev-mode warnings if any; treat real errors as failures.
      const real = errors.filter((e) => !/Download the React DevTools/.test(e));
      await expect(real.length === 0, "console/page errors: " + real.join(" | "));
      return true;
    },
  },
];
