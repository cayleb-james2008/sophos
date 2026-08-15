// CommandPalette.test.tsx — the ⌘K command center overlay. Covers open/close
// via the global shortcut, rendering + filtering, command execution, the /name
// sub-mode, the find-session and search-transcript sub-modes, and the recent
// history breadcrumb.

import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi, beforeAll } from "vitest";
import { CommandPalette } from "../CommandPalette";

const mockIpc = vi.hoisted(() => ({
  listSessions: vi.fn(),
  setSessionName: vi.fn(),
  getSessionTree: vi.fn(),
  cloneSession: vi.fn(),
  runCommand: vi.fn(),
  refine: vi.fn(),
  compact: vi.fn(),
  retry: vi.fn(),
  prompt: vi.fn(),
  exportToHtml: vi.fn(),
}));

const mockTranscript = vi.hoisted(() => [] as any[]);

vi.mock("../../../ipc/client", async () => ({
  useIpc: () => mockIpc,
}));

vi.mock("../../chat/chatBridge", async () => ({
  useTranscriptMessages: () => mockTranscript,
  requestMessageFocus: vi.fn(),
}));

function openPalette() {
  const open = () =>
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true, bubbles: true }));
    });

  const { onNavigate, onNewSession, onFindSession } = {
    onNavigate: vi.fn(),
    onNewSession: vi.fn(),
    onFindSession: vi.fn(),
  };

  const utils = render(
    <CommandPalette onNavigate={onNavigate} onNewSession={onNewSession} onFindSession={onFindSession} />,
  );
  return { open, onNavigate, onNewSession, onFindSession, ...utils };
}

beforeEach(() => {
  vi.clearAllMocks();
  (mockIpc.listSessions as ReturnType<typeof vi.fn>).mockResolvedValue([]);
  (mockIpc.setSessionName as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
  mockTranscript.length = 0;
});

beforeAll(() => {
  // jsdom lacks scrollIntoView; the palette scrolls the selected row into view.
  Element.prototype.scrollIntoView = Element.prototype.scrollIntoView ?? vi.fn();
});

describe("CommandPalette", () => {
  it("is closed initially and opens on the global ⌘K shortcut", () => {
    const { open } = openPalette();
    expect(screen.queryByRole("dialog", { name: /command palette/i })).not.toBeInTheDocument();

    open();
    expect(screen.getByRole("dialog", { name: /command palette/i })).toBeInTheDocument();
  });

  it("closes with Escape", async () => {
    const user = userEvent.setup();
    const { open } = openPalette();
    open();
    expect(screen.getByRole("dialog", { name: /command palette/i })).toBeInTheDocument();

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: /command palette/i })).not.toBeInTheDocument();
  });

  it("shows a no-commands message for a nonsense query", async () => {
    const user = userEvent.setup();
    const { open } = openPalette();
    open();
    await user.type(screen.getByPlaceholderText("Type a command or search…"), "zzzzz");
    expect(screen.getByText(/No commands match/i)).toBeInTheDocument();
  });

  it("filters commands as the query narrows them", async () => {
    const user = userEvent.setup();
    const { open } = openPalette();
    open();
    // Before typing, many commands render.
    expect(screen.getAllByText("Go to Chat")).toBeDefined();
    await user.type(screen.getByPlaceholderText("Type a command or search…"), "clone");
    // The /clone row should still be present.
    expect(screen.getByText("/clone")).toBeInTheDocument();
    expect(screen.queryByText("Go to Chat")).not.toBeInTheDocument();
  });

  it("runs a navigation command when its row is clicked", async () => {
    const user = userEvent.setup();
    const { open, onNavigate } = openPalette();
    open();
    await user.click(screen.getByText("Go to Chat"));
    expect(onNavigate).toHaveBeenCalledWith("chat");
    // Non-sub-mode commands close the palette.
    expect(screen.queryByRole("dialog", { name: /command palette/i })).not.toBeInTheDocument();
  });

  it("opens the naming sub-mode and persists a name via setSessionName", async () => {
    const user = userEvent.setup();
    const { open } = openPalette();
    open();

    await user.click(screen.getByText("/name"));
    // The naming form appears.
    const nameInput = screen.getByLabelText("Session name");
    await user.type(nameInput, "My task");

    const save = screen.getByRole("button", { name: /^save$/i });
    await user.click(save);

    expect(mockIpc.setSessionName).toHaveBeenCalledWith("My task");
    // Saving closes the palette.
    expect(screen.queryByRole("dialog", { name: /command palette/i })).not.toBeInTheDocument();
  });

  it("opens the find-session sub-mode and lists sessions", async () => {
    const user = userEvent.setup();
    (mockIpc.listSessions as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: "s-1", title: "Alpha", status: "saved" },
    ]);
    const { open, onFindSession } = openPalette();
    open();

    await user.click(screen.getByText("Find session…"));
    expect(mockIpc.listSessions).toHaveBeenCalledTimes(1);

    await user.type(screen.getByLabelText("Search sessions"), "alpha");
    // The matching session row appears; clicking it navigates to sessions.
    await user.click(screen.getByText("Alpha"));
    expect(onFindSession).toHaveBeenCalledWith("alpha", "s-1");
  });

  it("opens the search-transcript sub-mode and reports no messages when empty", async () => {
    const user = userEvent.setup();
    const { open } = openPalette();
    open();
    await user.click(screen.getByText("Search transcript…"));
    expect(screen.getByText(/No messages in the current session to search/i)).toBeInTheDocument();
  });

  it("records history and surfaces a Recent breadcrumb on reopen", async () => {
    const user = userEvent.setup();
    const { open } = openPalette();
    open();
    await user.type(screen.getByPlaceholderText("Type a command or search…"), "chat");
    await user.click(screen.getByText("Go to Chat"));

    // Reopen — the recent query should appear under a Recent header.
    open();
    expect(screen.getByText("Recent")).toBeInTheDocument();
  });
});
