// ExtensionsPanel.test.tsx — ExtensionsPanel lists live + configured extensions,
// expands an extension to reveal its tools and slash commands, toggles enable,
// and installs / removes extensions through the IPC client.

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ExtensionsPanel } from "../ExtensionsPanel";

const mockClient = vi.hoisted(() => ({
  getSettings: vi.fn(),
  getRuntimeInfo: vi.fn(),
  getExtensions: vi.fn(),
  setSettings: vi.fn(),
  installExtension: vi.fn(),
  removeExtension: vi.fn(),
}));

vi.mock("../../../ipc/client", async () => ({
  useIpc: () => mockClient,
  useIpcEvent: () => undefined,
  useConnectionState: () => ({ status: { kind: "connected" } }),
}));

const RUNTIME = {
  cwd: "C:\\work",
  kernel: { status: "configured", persistent: true, toolAvailable: true },
  skills: [],
  skillDiagnostics: [],
  extensions: ["C:\\ext"],
};

beforeEach(() => {
  vi.clearAllMocks();
  (mockClient.getSettings as ReturnType<typeof vi.fn>).mockResolvedValue({
    extensions: [{ name: "my-ext", path: "C:\\ext", enabled: true }],
  });
  (mockClient.getRuntimeInfo as ReturnType<typeof vi.fn>).mockResolvedValue(JSON.parse(JSON.stringify(RUNTIME)));
  (mockClient.getExtensions as ReturnType<typeof vi.fn>).mockResolvedValue([
    {
      name: "my-ext",
      path: "C:\\ext",
      enabled: true,
      tools: [{ name: "tool1", description: "Runs a thing" }],
      slashCommands: [{ name: "extcmd", description: "Runs a command" }],
    },
  ]);
  (mockClient.setSettings as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
  (mockClient.installExtension as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
  (mockClient.removeExtension as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
});

describe("ExtensionsPanel", () => {
  it("renders live extensions and the configured extension", async () => {
    render(<ExtensionsPanel />);

    await waitFor(() => expect(screen.getByText("my-ext")).toBeInTheDocument());
    // The path appears both in the live-extensions list and the configured row.
    expect(screen.getAllByText("C:\\ext").length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText(/^1$/).length).toBeGreaterThanOrEqual(2); // live + configured counts
  });

  it("expands an extension to reveal its tools and slash commands", async () => {
    const user = userEvent.setup();
    render(<ExtensionsPanel />);
    await waitFor(() => expect(screen.getByText("my-ext")).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: /toggle details for my-ext/i }));

    expect(screen.getByText("tool1")).toBeInTheDocument();
    expect(screen.getByText("/extcmd")).toBeInTheDocument();
    expect(screen.getByText(/Runs a thing/)).toBeInTheDocument();
  });

  it("toggles an extension off and persists via setSettings", async () => {
    const user = userEvent.setup();
    render(<ExtensionsPanel />);
    await waitFor(() => expect(screen.getByText("my-ext")).toBeInTheDocument());

    await user.click(screen.getAllByRole("checkbox")[0]);

    await waitFor(() => {
      expect(mockClient.setSettings).toHaveBeenCalledWith(
        expect.objectContaining({ extensions: [expect.objectContaining({ name: "my-ext", enabled: false })] }),
      );
    });
  });

  it("installs an extension from a path", async () => {
    const user = userEvent.setup();
    render(<ExtensionsPanel />);
    await waitFor(() => expect(screen.getByText("my-ext")).toBeInTheDocument());

    await user.type(screen.getByLabelText("Extension path"), "C:\\new-ext");
    await user.click(screen.getByRole("button", { name: /^install$/i }));

    await waitFor(() => expect(mockClient.installExtension).toHaveBeenCalledWith("C:\\new-ext"));
    expect(await screen.findByText(/Installed extension C:\\new-ext/i)).toBeInTheDocument();
  });

  it("removes an extension and reports the result", async () => {
    const user = userEvent.setup();
    render(<ExtensionsPanel />);
    await waitFor(() => expect(screen.getByText("my-ext")).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: /remove my-ext/i }));

    await waitFor(() => expect(mockClient.removeExtension).toHaveBeenCalledWith("C:\\ext"));
    expect(await screen.findByText(/Removed extension C:\\ext/i)).toBeInTheDocument();
  });
});
