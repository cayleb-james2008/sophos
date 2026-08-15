// GeneralPanel.test.tsx — GeneralPanel loads settings, lets the user edit each
// field, persists the whole draft on Save, applies the theme immediately, and
// re-launches onboarding from a dedicated button.

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GeneralPanel } from "../GeneralPanel";

const mockClient = vi.hoisted(() => ({
  getSettings: vi.fn(),
  setSettings: vi.fn(),
}));

const mockSetView = vi.hoisted(() => vi.fn());
const mockClearOnboarding = vi.hoisted(() => vi.fn());

vi.mock("../../../ipc/client", async () => ({
  useIpc: () => mockClient,
  useIpcEvent: () => undefined,
  useConnectionState: () => ({ status: { kind: "connected" } }),
}));

vi.mock("../../../state/AppState", async () => ({
  useAppState: () => ({ setView: mockSetView }),
}));

vi.mock("../FirstRunBanner", async () => ({
  clearOnboardingDismissed: mockClearOnboarding,
}));

const SAVED = {
  theme: "dark",
  defaultProvider: "ollama-cloud",
  defaultModel: "deepseek-v4-flash:0731-cloud",
  shellPath: "C:\\Windows\\System32\\cmd.exe",
  sessionDir: "C:\\Users\\you\\.prime\\sessions",
  daemonCliPath: "C:\\path\\to\\daemon-cli.exe",
};

beforeEach(() => {
  vi.clearAllMocks();
  (mockClient.getSettings as ReturnType<typeof vi.fn>).mockResolvedValue({ ...SAVED });
  (mockClient.setSettings as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
  document.documentElement.removeAttribute("data-theme");
});

describe("GeneralPanel", () => {
  it("loads and populates every field from saved settings", async () => {
    render(<GeneralPanel />);

    await waitFor(() => expect(screen.getByLabelText("Default provider")).toHaveValue("ollama-cloud"));
    expect(screen.getByLabelText("Default model")).toHaveValue("deepseek-v4-flash:0731-cloud");
    expect(screen.getByLabelText("Shell path")).toHaveValue("C:\\Windows\\System32\\cmd.exe");
    expect(screen.getByLabelText("Session directory")).toHaveValue("C:\\Users\\you\\.prime\\sessions");
    expect(screen.getByLabelText("Daemon CLI path")).toHaveValue("C:\\path\\to\\daemon-cli.exe");
    expect(screen.getByLabelText("Theme")).toHaveValue("dark");
  });

  it("disables Save until settings have loaded", () => {
    render(<GeneralPanel />);
    const save = screen.getByRole("button", { name: /save changes/i });
    expect(save).toBeDisabled();
  });

  it("persists edits via setSettings with the merged draft", async () => {
    const user = userEvent.setup();
    render(<GeneralPanel />);
    await waitFor(() => expect(screen.getByLabelText("Default model")).toBeInTheDocument());

    await user.clear(screen.getByLabelText("Default model"));
    await user.type(screen.getByLabelText("Default model"), "gpt-4o");
    await user.click(screen.getByRole("button", { name: /save changes/i }));

    await waitFor(() => {
      expect(mockClient.setSettings).toHaveBeenCalledWith(expect.objectContaining({ defaultModel: "gpt-4o" }));
    });
  });

  it("applies the theme immediately on change and persists it on save", async () => {
    const user = userEvent.setup();
    render(<GeneralPanel />);
    await waitFor(() => expect(screen.getByLabelText("Theme")).toBeInTheDocument());

    await user.selectOptions(screen.getByLabelText("Theme"), "light");
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");

    await user.click(screen.getByRole("button", { name: /save changes/i }));
    await waitFor(() => {
      expect(mockClient.setSettings).toHaveBeenCalledWith(expect.objectContaining({ theme: "light" }));
    });
  });

  it("clears the draft when Reset is clicked", async () => {
    const user = userEvent.setup();
    render(<GeneralPanel />);
    await waitFor(() => expect(screen.getByLabelText("Default provider")).toHaveValue("ollama-cloud"));

    await user.click(screen.getByRole("button", { name: /reset/i }));

    expect(screen.getByLabelText("Default provider")).toHaveValue("");
    expect(screen.getByLabelText("Default model")).toHaveValue("");
  });

  it("re-launches onboarding: clears the dismiss flag and jumps to chat", async () => {
    const user = userEvent.setup();
    render(<GeneralPanel />);
    await waitFor(() => expect(screen.getByTitle(/clear the first-run dismiss flag/i)).toBeInTheDocument());

    await user.click(screen.getByTitle(/clear the first-run dismiss flag/i));

    expect(mockClearOnboarding).toHaveBeenCalledTimes(1);
    expect(mockSetView).toHaveBeenCalledWith("chat");
  });
});
