// ChatView — export / share / fork tests. We mock the IPC client, the Tauri
// dialog plugin, and the heavy child components so the view's action wiring is
// exercised in isolation:
//   * Export opens a format picker (HTML / JSONL), then the native save dialog,
//     then the matching IPC export — honest toast with the path.
//   * Share calls runCommand("share") and surfaces the real result — never the
//     old "Share not available yet" stub.
//   * Fork calls forkSession(message.id) and reloads the transcript.

import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ChatView } from "../ChatView";

const mockSave = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/plugin-dialog", () => ({ save: mockSave }));

const mockIpc = vi.hoisted(() => ({
  runCommand: vi.fn(),
  exportToHtml: vi.fn(),
  exportToJsonl: vi.fn(),
  forkSession: vi.fn(),
}));

vi.mock("../../../ipc/client", () => ({
  useIpc: () => mockIpc,
  useConnectionState: () => ({ status: { kind: "connected" } }),
  isTauri: true,
}));

vi.mock("../../../state/AppState", () => ({
  useAppState: () => ({
    setNewSessionOpen: vi.fn(),
    setSettingsTab: vi.fn(),
    setView: vi.fn(),
  }),
}));

vi.mock("../../settings/FirstRunBanner", () => ({
  FirstRunBanner: () => null,
  useOnboardingStatus: () => ({ hasProvider: true, ready: true }),
}));

const mockReload = vi.hoisted(() => vi.fn());

vi.mock("../useChat", () => ({
  useChat: () => ({
    messages: [],
    busy: false,
    loaded: true,
    error: null,
    hasFirstMessage: false,
    send: vi.fn(),
    steer: vi.fn(),
    abort: vi.fn(),
    queueFollowUp: vi.fn(),
    clearFollowUps: vi.fn(),
    popFollowUp: vi.fn(),
    followUps: [],
    steered: false,
    shellNotice: null,
    askSideQuestion: vi.fn(),
    dismissSideQuestion: vi.fn(),
    sideQuestions: [],
    runShell: vi.fn(),
    contextStats: null,
    setSessionName: vi.fn(),
    compact: vi.fn(),
    reload: mockReload,
    loadDemoMessages: vi.fn(),
    editDraft: null,
    requestEdit: vi.fn(),
    retry: vi.fn(),
  }),
}));

// MessageList stub exposes onFork so we can drive the fork wiring from the test.
vi.mock("../MessageList", () => ({
  MessageList: ({ onFork }: { onFork?: (m: { id: string; role?: string; content?: string }) => void }) => (
    <button onClick={() => onFork?.({ id: "m1", role: "assistant", content: "hi" })}>fork-test</button>
  ),
}));
vi.mock("../Composer", () => ({ Composer: () => null }));
vi.mock("../ContextBar", () => ({ ContextBar: () => null }));
vi.mock("../../providers/ModelSelector", () => ({ ModelSelector: () => null }));

beforeEach(() => {
  vi.clearAllMocks();
  mockSave.mockReset();
  mockIpc.runCommand.mockReset();
  mockIpc.exportToHtml.mockReset();
  mockIpc.exportToJsonl.mockReset();
  mockIpc.forkSession.mockReset();
  mockReload.mockReset();
});

describe("ChatView export", () => {
  it("opens the format picker, then the save dialog, then exportToHtml with the chosen path", async () => {
    mockSave.mockResolvedValue("C:\\out\\session.html");
    mockIpc.exportToHtml.mockResolvedValue({ outputPath: "C:\\out\\session.html" });
    render(<ChatView />);

    // Header Export button opens the format picker.
    fireEvent.click(screen.getByTitle("Export session"));
    expect(screen.getByText("HTML")).toBeTruthy();
    expect(screen.getByText("JSONL")).toBeTruthy();

    // Choosing HTML calls the save dialog, then exportToHtml(path).
    fireEvent.click(screen.getByText("HTML"));
    await waitFor(() => {
      expect(mockSave).toHaveBeenCalledTimes(1);
      expect(mockIpc.exportToHtml).toHaveBeenCalledWith("C:\\out\\session.html");
    });
    expect(screen.getByText(/Exported to C:\\out\\session.html/)).toBeTruthy();
  });

  it("choosing JSONL calls exportToJsonl with the chosen path", async () => {
    mockSave.mockResolvedValue("C:\\out\\session.jsonl");
    mockIpc.exportToJsonl.mockResolvedValue({ outputPath: "C:\\out\\session.jsonl" });
    render(<ChatView />);

    fireEvent.click(screen.getByTitle("Export session"));
    fireEvent.click(screen.getByText("JSONL"));
    await waitFor(() => {
      expect(mockSave).toHaveBeenCalledTimes(1);
      expect(mockIpc.exportToJsonl).toHaveBeenCalledWith("C:\\out\\session.jsonl");
    });
  });

  it("surfaces the real error when the export IPC call fails", async () => {
    mockSave.mockResolvedValue("C:\\out\\session.html");
    mockIpc.exportToHtml.mockRejectedValue(new Error("disk full"));
    render(<ChatView />);

    fireEvent.click(screen.getByTitle("Export session"));
    fireEvent.click(screen.getByText("HTML"));
    await waitFor(() => {
      expect(screen.getByText("disk full")).toBeTruthy();
    });
  });

  it("does not export when the user cancels the save dialog", async () => {
    mockSave.mockResolvedValue(null);
    render(<ChatView />);

    fireEvent.click(screen.getByTitle("Export session"));
    fireEvent.click(screen.getByText("HTML"));
    await waitFor(() => {
      expect(mockSave).toHaveBeenCalledTimes(1);
      expect(mockIpc.exportToHtml).not.toHaveBeenCalled();
    });
  });
});

describe("ChatView share", () => {
  it("calls runCommand('share') and shows a success toast", async () => {
    mockIpc.runCommand.mockResolvedValue(undefined);
    render(<ChatView />);

    fireEvent.click(screen.getByTitle("Share as GitHub gist"));
    await waitFor(() => {
      expect(mockIpc.runCommand).toHaveBeenCalledWith("share");
    });
    expect(screen.getByText("Session shared")).toBeTruthy();
  });

  it("surfaces the real error honestly (never 'Share not available yet')", async () => {
    mockIpc.runCommand.mockRejectedValue(new Error("gist auth failed"));
    render(<ChatView />);

    fireEvent.click(screen.getByTitle("Share as GitHub gist"));
    await waitFor(() => {
      expect(screen.getByText("gist auth failed")).toBeTruthy();
    });
    expect(screen.queryByText(/Share not available yet/)).toBeNull();
  });
});

describe("ChatView fork", () => {
  it("calls forkSession(message.id), reloads, and shows a success toast", async () => {
    mockIpc.forkSession.mockResolvedValue(undefined);
    mockReload.mockResolvedValue(undefined);
    render(<ChatView />);

    fireEvent.click(screen.getByText("fork-test"));
    await waitFor(() => {
      expect(mockIpc.forkSession).toHaveBeenCalledWith("m1");
    });
    expect(mockReload).toHaveBeenCalled();
    expect(screen.getByText(/Forked — new session created from this message/)).toBeTruthy();
  });

  it("surfaces the real error when fork fails", async () => {
    mockIpc.forkSession.mockRejectedValue(new Error("fork failed"));
    render(<ChatView />);

    fireEvent.click(screen.getByText("fork-test"));
    await waitFor(() => {
      expect(screen.getByText("fork failed")).toBeTruthy();
    });
  });
});
