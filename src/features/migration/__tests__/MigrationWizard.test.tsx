// MigrationWizard.test.tsx — verifies the MigrationWizard component's UI,
// live preview reactivity, settings/profile import execution, and defensive error handling.

import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MigrationWizard } from "../MigrationWizard";

const mockClient = vi.hoisted(() => ({
  getSettings: vi.fn(),
  setSettings: vi.fn(),
}));

vi.mock("../../../ipc/client", () => ({
  useIpc: () => mockClient,
  isTauri: false,
}));

beforeEach(() => {
  vi.clearAllMocks();
  (mockClient.getSettings as ReturnType<typeof vi.fn>).mockResolvedValue({
    theme: "dark",
    customProfiles: [],
  });
  (mockClient.setSettings as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
});

describe("MigrationWizard", () => {
  it("renders all source inputs and disables Import when inputs are empty", () => {
    render(<MigrationWizard />);
    expect(screen.getByText(/Import from Claude Desktop \/ Codex Desktop/i)).toBeInTheDocument();
    expect(screen.getByLabelText("CLAUDE.md instructions")).toBeInTheDocument();
    expect(screen.getByLabelText("Claude config JSON")).toBeInTheDocument();
    expect(screen.getByLabelText("Codex config (JSON or TOML)")).toBeInTheDocument();

    const importBtn = screen.getByRole("button", { name: "Import" });
    expect(importBtn).toBeDisabled();
  });

  it("updates live preview when CLAUDE.md instructions are entered", async () => {
    render(<MigrationWizard />);

    fireEvent.change(screen.getByLabelText("CLAUDE.md instructions"), {
      target: { value: "You are an AI Architect specialized in system design." },
    });

    expect(
      screen.getByText(/Will become the custom profile instructions \(53 chars\)\./i),
    ).toBeInTheDocument();
    const importBtn = screen.getByRole("button", { name: "Import" });
    expect(importBtn).not.toBeDisabled();
  });

  it("updates live preview with model, auth, and MCP servers from Claude JSON", async () => {
    render(<MigrationWizard />);

    const sampleJson = JSON.stringify({
      model: "claude-3-5-sonnet",
      auth: { anthropic: "sk-test-key-123" },
      mcpServers: {
        git: { command: "npx", args: ["-y", "mcp-server-git"] },
      },
    });

    fireEvent.change(screen.getByLabelText("Claude config JSON"), {
      target: { value: sampleJson },
    });

    await waitFor(() => {
      expect(screen.getByText("claude-3-5-sonnet")).toBeInTheDocument();
      expect(screen.getByText("anthropic (carried over as-is)")).toBeInTheDocument();
      expect(screen.getByText("1 server(s)")).toBeInTheDocument();
    });
  });

  it("executes import on click, persists merged settings, and shows success notice", async () => {
    const user = userEvent.setup();
    render(<MigrationWizard />);

    fireEvent.change(screen.getByLabelText("CLAUDE.md instructions"), {
      target: { value: "Architect instructions" },
    });
    fireEvent.change(screen.getByLabelText("Claude config JSON"), {
      target: { value: JSON.stringify({ model: "claude-opus-4", auth: { anthropic: "sk-ant" } }) },
    });

    const importBtn = screen.getByRole("button", { name: "Import" });
    await user.click(importBtn);

    await waitFor(() => {
      expect(mockClient.setSettings).toHaveBeenCalledWith(
        expect.objectContaining({
          defaultModel: "claude-opus-4",
          auth: { anthropic: "sk-ant" },
          customProfiles: expect.arrayContaining([
            expect.objectContaining({
              name: "Imported from Claude Desktop",
              systemPrompt: "Architect instructions",
            }),
          ]),
        }),
      );
    });

    expect(screen.getByText(/Imported and set model "claude-opus-4"/i)).toBeInTheDocument();
  });

  it("handles malformed JSON defensively by surfacing a warning note without crashing", async () => {
    render(<MigrationWizard />);

    fireEvent.change(screen.getByLabelText("Claude config JSON"), {
      target: { value: "{not-json" },
    });

    await waitFor(() => {
      expect(
        screen.getByText(/Claude config text is not valid JSON — fix it or clear the field\./i),
      ).toBeInTheDocument();
    });
  });
});
