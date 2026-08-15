// ChatView — the Operate surface (apex component of the chat feature). Covers
// the loading skeleton vs loaded transcript, the error card + retry gating
// (enabled only when a retryable assistant message exists), export/copy header
// actions + toast lifecycle, connection-status rendering, the demo-mode branch,
// and onboarding wiring. Heavy deps (useChat, ipc, app state, onboarding,
// ModelSelector, OnboardingWizard) are mocked; MessageList/Composer/ContextBar
// run for real.

import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChatView } from "../ChatView";
import type { TranscriptMessage } from "../../../ipc/contract";

const mockState = vi.hoisted(() => {
  const chat = {
    messages: [] as TranscriptMessage[],
    busy: false,
    loaded: true,
    error: null as string | null,
    hasFirstMessage: false,
    send: vi.fn(),
    steer: vi.fn(),
    abort: vi.fn(),
    queueFollowUp: vi.fn(),
    clearFollowUps: vi.fn(),
    popFollowUp: vi.fn(),
    followUps: [] as unknown[],
    steered: null,
    shellNotice: null,
    askSideQuestion: vi.fn(),
    dismissSideQuestion: vi.fn(),
    sideQuestions: [] as unknown[],
    runShell: vi.fn(),
    contextStats: null,
    setSessionName: vi.fn(),
    editDraft: null,
    requestEdit: vi.fn(),
    retry: vi.fn(),
    loadDemoMessages: vi.fn(),
  };
  return {
    chat,
    appState: { setNewSessionOpen: vi.fn(), setSettingsTab: vi.fn(), setView: vi.fn() },
    onboarding: { checks: [], ready: true, hasProvider: true, hasFreeProvider: true, refresh: vi.fn() },
    ipc: {
      exportToHtml: vi.fn().mockResolvedValue({}),
      getSlashCommands: vi.fn().mockResolvedValue([]),
      runCommand: vi.fn().mockResolvedValue(undefined),
    },
    conn: { status: { kind: "connected" } },
    isTauri: false, // browser/demo path: covers the demo-mode branch
  };
});

vi.mock("../../../ipc/client", () => ({
  useIpc: () => mockState.ipc,
  useConnectionState: () => mockState.conn,
  isTauri: mockState.isTauri,
}));

vi.mock("../../../state/AppState", () => ({
  useAppState: () => mockState.appState,
}));

vi.mock("../useChat", () => ({
  useChat: () => mockState.chat,
}));

vi.mock("../../../features/settings/FirstRunBanner", () => ({
  useOnboardingStatus: () => mockState.onboarding,
}));

vi.mock("../../../features/providers/ModelSelector", () => ({
  ModelSelector: () => null,
}));

vi.mock("../../../features/settings/OnboardingWizard", () => ({
  OnboardingWizard: ({ onSetupProviders, onStartChat }: { onSetupProviders: () => void; onStartChat: () => void }) => (
    <div data-testid="mock-onboarding">
      <button type="button" onClick={onSetupProviders}>setup providers</button>
      <button type="button" onClick={onStartChat}>start chat</button>
    </div>
  ),
}));

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}

const clipboard = { writeText: vi.fn().mockResolvedValue(undefined) };
const asst = (content: string): TranscriptMessage => ({ id: "a-1", role: "assistant", content, timestamp: "2026-01-01T12:00:00.000Z", status: "complete" });

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("ResizeObserver", ResizeObserverMock);
  Object.defineProperty(navigator, "clipboard", { value: clipboard, configurable: true });
  mockState.chat.messages = [];
  mockState.chat.loaded = true;
  mockState.chat.error = null;
  mockState.conn = { status: { kind: "connected" } };
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("ChatView loading vs loaded", () => {
  it("shows a loading skeleton while the transcript has not loaded", () => {
    mockState.chat.loaded = false;
    render(<ChatView />);
    expect(document.querySelector(".chat-loading")).toBeInTheDocument();
    expect(document.querySelector(".chat-loading")).toHaveAttribute("aria-busy", "true");
    expect(document.querySelector(".msglist")).toBeNull();
  });

  it("renders the transcript once loaded", () => {
    mockState.chat.messages = [asst("hello there")];
    render(<ChatView />);
    expect(document.querySelector(".chat-loading")).toBeNull();
    expect(screen.getByText("hello there")).toBeInTheDocument();
  });
});

describe("ChatView error card", () => {
  it("shows the error and disables Retry when there is no retryable assistant", () => {
    mockState.chat.error = "daemon down";
    mockState.chat.messages = [];
    render(<ChatView />);
    const alert = screen.getByRole("alert");
    expect(alert).toBeInTheDocument();
    expect(screen.getByText("daemon down")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /retry/i })).toBeDisabled();
  });

  it("enables Retry and re-issues the last assistant turn when one exists", () => {
    const a = asst("an answer");
    mockState.chat.error = "boom";
    mockState.chat.messages = [{ id: "u-1", role: "user", content: "q", timestamp: "2026", status: "complete" }, a];
    render(<ChatView />);
    // Scope to the error card: the assistant row also renders a MessageActions retry.
    const retry = within(screen.getByRole("alert")).getByRole("button", { name: /retry/i });
    expect(retry).toBeEnabled();
    fireEvent.click(retry);
    expect(mockState.chat.retry).toHaveBeenCalledWith(a);
  });
});

describe("ChatView header actions", () => {
  it("calls exportToHtml and shows a toast on export", () => {
    render(<ChatView />);
    fireEvent.click(screen.getByRole("button", { name: /export session to html/i }));
    expect(mockState.ipc.exportToHtml).toHaveBeenCalled();
    expect(screen.getByText("Exporting session to HTML…")).toBeInTheDocument();
  });

  it("copies the last assistant message and shows a toast", async () => {
    mockState.chat.messages = [asst("final answer")];
    render(<ChatView />);
    fireEvent.click(screen.getByRole("button", { name: /copy last assistant message/i }));
    await waitFor(() => expect(clipboard.writeText).toHaveBeenCalledWith("final answer"));
    await waitFor(() => expect(screen.getByText("Copied last assistant message")).toBeInTheDocument());
  });

  it("shows a notice and does not copy when there is no assistant message", () => {
    mockState.chat.messages = [];
    render(<ChatView />);
    fireEvent.click(screen.getByRole("button", { name: /copy last assistant message/i }));
    expect(clipboard.writeText).not.toHaveBeenCalled();
    expect(screen.getByText("No assistant message to copy")).toBeInTheDocument();
  });

  it("auto-clears the toast after the timeout", () => {
    vi.useFakeTimers();
    render(<ChatView />);
    fireEvent.click(screen.getByRole("button", { name: /copy last assistant message/i }));
    expect(screen.getByText("No assistant message to copy")).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(2600);
    });
    expect(screen.queryByText("No assistant message to copy")).not.toBeInTheDocument();
  });
});

describe("ChatView connection status", () => {
  it("renders each connection status kind", () => {
    for (const kind of ["connecting", "connected", "reconnecting", "disconnected"]) {
      mockState.conn = { status: { kind } };
      const { unmount } = render(<ChatView />);
      expect(screen.getByText(kind)).toBeInTheDocument();
      unmount();
    }
  });
});

describe("ChatView demo mode + onboarding", () => {
  it("shows the demo banner and loads 500 demo messages", () => {
    render(<ChatView />);
    expect(screen.getByText(/demo mode/i)).toBeInTheDocument();
    // The developer preview is collapsed by default; open it to expose the button.
    fireEvent.click(screen.getByText("Developer preview"));
    fireEvent.click(screen.getByRole("button", { name: /load 500 messages/i }));
    expect(mockState.chat.loadDemoMessages).toHaveBeenCalledWith(500);
  });

  it("routes the setup-providers action to the settings providers tab", () => {
    render(<ChatView />);
    fireEvent.click(screen.getByRole("button", { name: /setup providers/i }));
    expect(mockState.appState.setSettingsTab).toHaveBeenCalledWith("providers");
    expect(mockState.appState.setView).toHaveBeenCalledWith("settings");
  });

  it("opens a new session from the header button", () => {
    render(<ChatView />);
    fireEvent.click(screen.getByRole("button", { name: /new session/i }));
    expect(mockState.appState.setNewSessionOpen).toHaveBeenCalledWith(true);
  });
});
