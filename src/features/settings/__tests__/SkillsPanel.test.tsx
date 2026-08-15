// SkillsPanel.test.tsx — SkillsPanel reads the live daemon resource snapshot,
// toggles discovered skills on/off, manages skill discovery paths, and creates /
// installs skills through the IPC client.

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SkillsPanel } from "../SkillsPanel";

const mockClient = vi.hoisted(() => ({
  getSettings: vi.fn(),
  getRuntimeInfo: vi.fn(),
  setSettings: vi.fn(),
  createSkill: vi.fn(),
  installSkill: vi.fn(),
}));

vi.mock("../../../ipc/client", async () => ({
  useIpc: () => mockClient,
  useIpcEvent: () => undefined,
  useConnectionState: () => ({ status: { kind: "connected" } }),
}));

const RUNTIME = {
  cwd: "C:\\work",
  kernel: { status: "configured", persistent: true, toolAvailable: true },
  skills: [
    { name: "release-audit", description: "Audit a release artifact", filePath: "C:\\skills\\release-audit", source: "local" },
    { name: "qa", description: "Run the QA battery", filePath: "C:\\skills\\qa" },
  ],
  skillDiagnostics: [{ type: "warn", message: "Could not load path", path: "bad/dir" }],
  extensions: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  (mockClient.getSettings as ReturnType<typeof vi.fn>).mockResolvedValue({ skills: [], disabledSkills: [] });
  (mockClient.getRuntimeInfo as ReturnType<typeof vi.fn>).mockResolvedValue(JSON.parse(JSON.stringify(RUNTIME)));
  (mockClient.setSettings as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
  (mockClient.createSkill as ReturnType<typeof vi.fn>).mockResolvedValue({ name: "new-skill" });
  (mockClient.installSkill as ReturnType<typeof vi.fn>).mockResolvedValue([{ name: "installed" }]);
});

describe("SkillsPanel", () => {
  it("renders the discovered skills and their diagnostics", async () => {
    render(<SkillsPanel />);

    await waitFor(() => expect(screen.getByText("release-audit")).toBeInTheDocument());
    expect(screen.getByText("qa")).toBeInTheDocument();
    expect(screen.getByText(/Audit a release artifact/)).toBeInTheDocument();
    expect(screen.getByText(/1 diagnostic/)).toBeInTheDocument();
  });

  it("toggles a discovered skill off and persists the disabled list", async () => {
    const user = userEvent.setup();
    render(<SkillsPanel />);
    await waitFor(() => expect(screen.getByText("release-audit")).toBeInTheDocument());

    // First Enable checkbox belongs to the first discovered skill.
    const checkboxes = screen.getAllByRole("checkbox");
    await user.click(checkboxes[0]);

    await waitFor(() => {
      expect(mockClient.setSettings).toHaveBeenCalledWith(
        expect.objectContaining({ disabledSkills: ["release-audit"] }),
      );
    });
  });

  it("adds a skill path to the draft and saves it", async () => {
    const user = userEvent.setup();
    render(<SkillsPanel />);
    await waitFor(() => expect(screen.getByText(/No skill paths configured/i)).toBeInTheDocument());

    await user.type(screen.getByPlaceholderText("~/.prime/agent/skills/new-skill"), "C:\\myskills");
    await user.click(screen.getByRole("button", { name: /add/i }));

    expect(screen.queryByText(/No skill paths configured/i)).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /save changes/i }));

    await waitFor(() => {
      expect(mockClient.setSettings).toHaveBeenCalledWith(expect.objectContaining({ skills: ["C:\\myskills"] }));
    });
  });

  it("creates and installs a skill from the form", async () => {
    const user = userEvent.setup();
    render(<SkillsPanel />);
    await waitFor(() => expect(screen.getByText("release-audit")).toBeInTheDocument());

    await user.type(screen.getByLabelText("New skill name"), "new-skill");
    await user.type(screen.getByLabelText("Description"), "A brand new skill");
    await user.type(screen.getByLabelText("SKILL.md instructions"), "Use this skill when...");
    await user.click(screen.getByRole("button", { name: /create and install/i }));

    await waitFor(() => {
      expect(mockClient.createSkill).toHaveBeenCalledWith({
        name: "new-skill",
        description: "A brand new skill",
        content: "Use this skill when...",
      });
    });
    expect(await screen.findByText(/Created and installed new-skill/i)).toBeInTheDocument();
  });

  it("installs an existing skill path and reports the count", async () => {
    const user = userEvent.setup();
    render(<SkillsPanel />);
    await waitFor(() => expect(screen.getByText("release-audit")).toBeInTheDocument());

    await user.type(screen.getByLabelText("Existing skill path"), "C:\\work\\skills\\my-skill");
    await user.click(screen.getByRole("button", { name: /install path/i }));

    await waitFor(() => {
      expect(mockClient.installSkill).toHaveBeenCalledWith("C:\\work\\skills\\my-skill");
    });
    expect(await screen.findByText(/Installed skill path\. 1 skills are now visible/i)).toBeInTheDocument();
  });

  it("surfaces a create error in the action area", async () => {
    const user = userEvent.setup();
    (mockClient.createSkill as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("disk full"));
    render(<SkillsPanel />);
    await waitFor(() => expect(screen.getByText("release-audit")).toBeInTheDocument());

    await user.type(screen.getByLabelText("New skill name"), "x");
    await user.type(screen.getByLabelText("Description"), "y");
    await user.type(screen.getByLabelText("SKILL.md instructions"), "z");
    await user.click(screen.getByRole("button", { name: /create and install/i }));

    expect(await screen.findByText(/disk full/i)).toBeInTheDocument();
  });
});
