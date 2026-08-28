// SettingsView.test.tsx — SettingsView is the settings command center: it
// renders the fleet strip, a pill tab bar, and the panel for the active tab,
// delegating tab state to useAppState. Panels are stubbed to isolate the shell.

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsView } from "../SettingsView";

const mockSetSettingsTab = vi.hoisted(() => vi.fn());

vi.mock("../../../state/AppState", async () => ({
  useAppState: () => ({ settingsTab: "general", setSettingsTab: mockSetSettingsTab }),
}));

vi.mock("../FleetStrip", async () => ({
  FleetStrip: () => <div>fleet-stub</div>,
}));
vi.mock("../GeneralPanel", async () => ({ GeneralPanel: () => <div>general-stub</div> }));
vi.mock("../ProvidersPanel", async () => ({ ProvidersPanel: () => <div>providers-stub</div> }));
vi.mock("../SubagentPolicyPanel", async () => ({ SubagentPolicyPanel: () => <div>subagents-stub</div> }));
vi.mock("../SkillsPanel", async () => ({ SkillsPanel: () => <div>skills-stub</div> }));
vi.mock("../ExtensionsPanel", async () => ({ ExtensionsPanel: () => <div>extensions-stub</div> }));
vi.mock("../AdvancedPanel", async () => ({ AdvancedPanel: () => <div>advanced-stub</div> }));
vi.mock("../LongRunningPanel", async () => ({ LongRunningPanel: () => <div>longrunning-stub</div> }));
vi.mock("../AboutPanel", async () => ({ AboutPanel: () => <div>about-stub</div> }));
vi.mock("../../mcp", async () => ({ McpExplorer: () => <div>mcp-stub</div> }));
vi.mock("../../security", async () => ({ SecuritySandboxPanel: () => <div>security-stub</div> }));
vi.mock("../../cua", async () => ({ CuaControlPanel: () => <div>cua-stub</div> }));
vi.mock("../../skills", async () => ({ SkillDistillationPanel: () => <div>distill-stub</div> }));
vi.mock("../../tree", async () => ({ ThoughtTreePanel: () => <div>tree-stub</div> }));
vi.mock("../../sandbox", async () => ({ TwinSandboxPanel: () => <div>twins-stub</div> }));

describe("SettingsView", () => {
  beforeEach(() => {
    mockSetSettingsTab.mockClear();
  });

  it("renders the header, fleet strip, and tab bar", () => {
    render(<SettingsView />);
    expect(screen.getByRole("heading", { name: "Settings" })).toBeInTheDocument();
    expect(screen.getByText("CONTROL ROOM")).toBeInTheDocument();
    expect(screen.getByText("fleet-stub")).toBeInTheDocument();
    expect(screen.getByRole("tablist")).toBeInTheDocument();
  });

  it("renders the General panel for the default tab", () => {
    render(<SettingsView />);
    expect(screen.getByText("general-stub")).toBeInTheDocument();
  });

  it("marks the active tab and delegates tab changes to setSettingsTab", async () => {
    const user = userEvent.setup();
    render(<SettingsView />);

    const providers = screen.getByRole("tab", { name: /providers/i });
    expect(providers).toHaveAttribute("aria-selected", "false");

    await user.click(providers);
    expect(mockSetSettingsTab).toHaveBeenCalledWith("providers");
  });

  it("exposes every tab in the bar", () => {
    render(<SettingsView />);
    for (const label of [
      "General",
      "Providers",
      "MCP Explorer",
      "Security & Sandbox",
      "Desktop CUA",
      "Workspace Twins",
      "Skill Distillation",
      "Tree of Thoughts",
      "Subagents",
      "Skills",
      "Extensions",
      "Advanced",
      "Long-running",
      "Import",
      "About",
    ]) {
      expect(screen.getByRole("tab", { name: new RegExp(label, "i") })).toBeInTheDocument();
    }
  });
});
