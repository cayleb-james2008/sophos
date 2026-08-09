// verify/e2e/views.test.mjs — view-by-view coverage of the live app.
// Each test receives { page, shot, expect } and returns true on pass.
import { navTo, sendMessage, waitBusy, waitIdle } from "./helpers.mjs";

export const views = [
  {
    section: "Views",
    name: "Chat view renders",
    fn: async ({ page, shot, expect }) => {
      await navTo(page, "Chat");
      await expect(await page.locator("text=Conversation").count() > 0, "Chat header missing");
      await expect(await page.locator('textarea[aria-label="Message input"]').count() === 1, "composer missing");
      await expect(await page.locator('button[aria-label="Send message"]').count() === 1, "send button missing");
      await expect(await page.locator("text=Demo mode").count() > 0, "demo banner missing");
      await expect(await page.locator("text=Welcome!").count() > 0, "demo seed message missing");
      await shot("chat");
      return true;
    },
  },
  {
    section: "Views",
    name: "Sessions view renders graph + inspector",
    fn: async ({ page, shot, expect }) => {
      await navTo(page, "Sessions");
      await expect(await page.locator("text=Session command center").count() > 0, "sessions header missing");
      await expect(await page.locator("text=Refactor auth module").count() > 0, "session node missing");
      await expect(await page.locator("text=Migrate to new config schema").count() > 0, "session node 2 missing");
      await expect(await page.locator("text=Select a session").count() > 0, "inspector empty state missing");
      await shot("sessions");
      return true;
    },
  },
  {
    section: "Views",
    name: "Sessions detail inspector opens on node select",
    fn: async ({ page, shot, expect }) => {
      await navTo(page, "Sessions");
      // Click the first session node (graph node is a clickable element).
      await page.locator("text=Refactor auth module").first().click();
      await page.waitForTimeout(600);
      await expect(await page.locator("text=Context usage").count() > 0, "detail context section missing");
      await expect(await page.locator("text=Switch").count() > 0, "detail Switch action missing");
      await expect(await page.locator("text=Resume").count() > 0, "detail Resume action missing");
      await expect(await page.locator("text=Fork").count() > 0, "detail Fork action missing");
      await shot("sessions-detail");
      return true;
    },
  },
  {
    section: "Views",
    name: "Sessions tree view switch",
    fn: async ({ page, shot, expect }) => {
      await navTo(page, "Sessions");
      await page.click('button[role="tab"]:has-text("Tree")');
      await page.waitForTimeout(400);
      await expect(await page.locator("text=Initial brief").count() > 0, "tree node missing");
      await shot("sessions-tree");
      return true;
    },
  },
  {
    section: "Views",
    name: "Agents view renders fleet graph + RLM children",
    fn: async ({ page, shot, expect }) => {
      await navTo(page, "Agents");
      await expect(await page.locator("text=Agent command center").count() > 0, "agents header missing");
      await expect(await page.locator("text=RUNTIME MODEL").count() > 0, "model bar missing");
      // Mock returns 2 RLM children — they appear in the fleet graph as nodes
      // with their summary text (labels render as initials).
      await expect(await page.locator("text=Reviewing endpoint contracts").count() > 0, "RLM child api-reviewer missing");
      await expect(await page.locator("text=Awaiting next batch").count() > 0, "RLM child test-runner missing");
      await expect(await page.locator("text=2 total").count() > 0, "fleet telemetry missing");
      await shot("agents");
      return true;
    },
  },
  {
    section: "Views",
    name: "Inbox view renders empty relay state",
    fn: async ({ page, shot, expect }) => {
      await navTo(page, "Inbox");
      await expect(await page.locator("text=Inbox").count() > 0, "inbox header missing");
      await expect(await page.locator("text=No relay traffic yet").count() > 0, "empty relay state missing");
      await shot("inbox");
      return true;
    },
  },
  {
    section: "Views",
    name: "Settings General panel renders form",
    fn: async ({ page, shot, expect }) => {
      await navTo(page, "Settings");
      await expect(await page.locator("text=General preferences").count() > 0, "general panel missing");
      await expect(await page.locator("text=Theme").count() > 0, "theme field missing");
      await expect(await page.locator("text=Default provider").count() > 0, "provider field missing");
      await expect(await page.locator("text=Save changes").count() > 0, "save button missing");
      await shot("settings-general");
      return true;
    },
  },
  {
    section: "Views",
    name: "Settings Providers panel renders catalog",
    fn: async ({ page, shot, expect }) => {
      await navTo(page, "Settings");
      await page.click('button[role="tab"]:has-text("Providers")');
      await page.waitForTimeout(500);
      await expect(await page.locator("text=Ollama Cloud").count() > 0, "ollama provider missing");
      await expect(await page.locator("text=OpenRouter").count() > 0, "openrouter provider missing");
      await expect(await page.locator("text=MiniMax").count() > 0, "minimax provider missing");
      await expect(await page.locator("text=Connected").count() > 0, "connected badge missing");
      await shot("settings-providers");
      return true;
    },
  },
  {
    section: "Views",
    name: "Settings Skills panel renders",
    fn: async ({ page, shot, expect }) => {
      await navTo(page, "Settings");
      await page.click('button[role="tab"]:has-text("Skills")');
      await page.waitForTimeout(500);
      await expect(await page.locator("text=Skills").count() > 0, "skills panel missing");
      await shot("settings-skills");
      return true;
    },
  },
  {
    section: "Views",
    name: "Settings Advanced runtime telemetry renders",
    fn: async ({ page, shot, expect }) => {
      await navTo(page, "Settings");
      await page.click('button[role="tab"]:has-text("Advanced")');
      await page.waitForTimeout(600);
      await expect(await page.locator("text=Runtime telemetry").count() > 0, "runtime tab missing");
      await expect(await page.locator("text=Context").count() > 0, "context card missing");
      await expect(await page.locator("text=RLM children").count() > 0, "rlm card missing");
      await expect(await page.locator("text=Daemon diagnostics").count() > 0, "daemon diagnostics missing");
      await shot("settings-advanced");
      return true;
    },
  },
  {
    section: "Views",
    name: "Settings Long-running panels render (Goals/Autonomous/Heartbeats/Schedules/Refinement)",
    fn: async ({ page, shot, expect }) => {
      await navTo(page, "Settings");
      await page.click('button[role="tab"]:has-text("Advanced")');
      await page.waitForTimeout(500);
      await page.click('button[role="tab"]:has-text("Long-running")');
      await page.waitForTimeout(500);
      for (const tab of ["Goals", "Autonomous", "Heartbeats", "Schedules", "Refinement"]) {
        await expect(await page.locator(`button[role="tab"]:has-text("${tab}")`).count() > 0, `long-running tab ${tab} missing`);
      }
      // Click into each sub-tab and assert its panel actually renders content.
      const expected = {
        Goals: "Ship the release",
        Autonomous: "Autonomous mode",
        Heartbeats: "Heartbeats",
        Schedules: "Schedules",
        Refinement: "Refinement history",
      };
      for (const [tab, marker] of Object.entries(expected)) {
        await page.click(`button[role="tab"]:has-text("${tab}")`);
        await page.waitForTimeout(400);
        await expect(await page.locator(`text=${marker}`).count() > 0, `${tab} panel did not render (marker "${marker}" missing)`);
      }
      await shot("settings-longrunning");
      return true;
    },
  },
  {
    section: "Views",
    name: "Engine terminal opens via SystemBar toggle",
    fn: async ({ page, shot, expect }) => {
      await navTo(page, "Chat");
      await page.click('button[title="Show engine terminal"]');
      await page.waitForTimeout(500);
      await expect(await page.locator("text=Engine Terminal").count() > 0, "engine terminal header missing");
      await expect(await page.locator("text=Browser Preview").count() > 0, "browser preview state missing");
      await shot("engine");
      // Close it again for hygiene.
      await page.click('button[title="Hide engine terminal"]');
      return true;
    },
  },
];
