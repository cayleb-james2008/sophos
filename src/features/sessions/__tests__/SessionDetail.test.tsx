// SessionDetail.test.tsx — the right-hand session inspector. Mocks the IPC
// client (following the useChat pattern) so the transcript / context / goals /
// RLM-child loading, the inline rename, clone, compact modal, and fork-from-here
// flows run against a controllable client.

import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionInfo } from "../../../ipc/contract";
import { SessionDetail } from "../SessionDetail";

type AnyFn = (...args: never[]) => unknown;

const mockClient = vi.hoisted(() => ({
  getTranscript: vi.fn(),
  getContextStats: vi.fn(),
  getState: vi.fn(),
  setSessionName: vi.fn(),
  cloneSession: vi.fn(),
  compact: vi.fn(),
  forkSession: vi.fn(),
} as Record<string, AnyFn>));

vi.mock("../../../ipc/client", async () => ({
  useIpc: () => mockClient,
  useIpcEvent: () => undefined,
  useConnectionState: () => ({ status: { kind: "connected" } }),
  isTauri: false,
}));

const session: SessionInfo = {
  id: "s-1",
  title: "Refactor auth",
  status: "active",
  cwd: "C:\\work\\api",
  createdAt: new Date("2026-01-15T10:00:00.000Z").toISOString(),
  updatedAt: new Date("2026-01-15T11:00:00.000Z").toISOString(),
};

const transcript = [{ id: "m1", role: "user", content: "Hello from the user", timestamp: "2026-01-15T10:05:00.000Z" }];

function makeState() {
  return {
    goals: [{ id: "g1", objective: "Ship the release", status: "active", progress: "3 of 5" }],
    rlmChildren: [{ id: "r1", name: "reviewer", status: "running", summary: "Reviewing contracts" }],
  };
}

function makeClient() {
  (mockClient.getTranscript as ReturnType<typeof vi.fn>).mockResolvedValue(transcript);
  (mockClient.getContextStats as ReturnType<typeof vi.fn>).mockResolvedValue({ tokens: 2000, contextWindow: 10000, messages: 3 });
  (mockClient.getState as ReturnType<typeof vi.fn>).mockResolvedValue(makeState());
  (mockClient.setSessionName as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
  (mockClient.cloneSession as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
  (mockClient.compact as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
  (mockClient.forkSession as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
}

function renderDetail() {
  const handlers = { onSwitch: vi.fn(), onResume: vi.fn(), onFork: vi.fn() };
  render(<SessionDetail session={session} onSwitch={handlers.onSwitch} onResume={handlers.onResume} onFork={handlers.onFork} />);
  return handlers;
}

beforeEach(() => {
  vi.clearAllMocks();
  makeClient();
});

describe("SessionDetail", () => {
  it("shows a loading skeleton before data resolves", () => {
    renderDetail();
    expect(document.querySelector(".detail__skeleton")).not.toBeNull();
  });

  it("loads and renders context, goals, RLM children, and transcript", async () => {
    renderDetail();
    // 20% appears in both the ring center and the context meta readout.
    await waitFor(() => expect(screen.getAllByText("20%").length).toBeGreaterThan(0));

    expect(screen.getByText("Ship the release")).toBeInTheDocument();
    expect(screen.getByText("reviewer")).toBeInTheDocument();
    expect(screen.getByText("Hello from the user")).toBeInTheDocument();
    expect(screen.getByText("3 messages in context")).toBeInTheDocument();
  });

  it("surfaces the status label and session id", async () => {
    renderDetail();
    await waitFor(() => expect(screen.getByText(/session s-1/)).toBeInTheDocument());
    expect(screen.getByText(/Active/)).toBeInTheDocument();
  });

  it("renames the session via the inline editor and calls setSessionName", async () => {
    renderDetail();
    await waitFor(() => expect(screen.getByTitle("Rename session")).toBeInTheDocument());

    await userEvent.click(screen.getByTitle("Rename session"));
    const input = screen.getByDisplayValue("Refactor auth");
    await userEvent.clear(input);
    await userEvent.type(input, "Auth v2");
    await userEvent.keyboard("{Enter}");

    await waitFor(() => expect(mockClient.setSessionName).toHaveBeenCalledWith("Auth v2"));
    expect(screen.getByText("Auth v2")).toBeInTheDocument();
    expect(screen.getByText(/Session renamed/)).toBeInTheDocument();
  });

  it("shows an error block with Retry when a rename fails", async () => {
    (mockClient.setSessionName as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("rename down"));
    renderDetail();
    await waitFor(() => expect(screen.getByTitle("Rename session")).toBeInTheDocument());

    await userEvent.click(screen.getByTitle("Rename session"));
    const input = screen.getByDisplayValue("Refactor auth");
    await userEvent.clear(input);
    await userEvent.type(input, "Auth v2");
    await userEvent.keyboard("{Enter}");

    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(screen.getByText(/rename down/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
  });

  it("clones the session and shows a toast", async () => {
    renderDetail();
    await waitFor(() => expect(screen.getByRole("button", { name: /^Clone$/ })).toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: /^Clone$/ }));
    await waitFor(() => expect(mockClient.cloneSession).toHaveBeenCalled());
    expect(screen.getByText(/Session cloned/)).toBeInTheDocument();
  });

  it("runs compaction from the modal with a custom prompt", async () => {
    renderDetail();
    await waitFor(() => expect(screen.getByRole("button", { name: /^Compact$/ })).toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: /^Compact$/ }));
    expect(screen.getByText("Compact session")).toBeInTheDocument();

    const textarea = screen.getByLabelText("Custom compaction prompt (optional)");
    await userEvent.type(textarea, "focus on the auth refactor");
    await userEvent.click(screen.getByRole("button", { name: /compact now/i }));

    await waitFor(() => expect(mockClient.compact).toHaveBeenCalledWith("focus on the auth refactor"));
    // Modal closes and a confirmation toast appears.
    await waitFor(() => expect(screen.queryByText("Compact session")).not.toBeInTheDocument());
    expect(screen.getByText(/Compaction requested/)).toBeInTheDocument();
    // The detail is reloaded after compaction.
    expect(mockClient.getContextStats).toHaveBeenCalledTimes(2);
  });

  it("forks a new session from a user message via the inline confirm", async () => {
    renderDetail();
    await waitFor(() => expect(screen.getByText("Hello from the user")).toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: /fork from here/i }));
    expect(screen.getByText("Fork a new session from this point?")).toBeInTheDocument();

    // The confirm Fork button and the bottom-of-detail Fork action share the
    // same accessible name, so scope to the confirm box.
    const confirmBox = screen.getByText("Fork a new session from this point?").closest("div")!;
    await userEvent.click(within(confirmBox).getByRole("button", { name: /^Fork$/ }));
    await waitFor(() => expect(mockClient.forkSession).toHaveBeenCalledWith("m1"));
    expect(screen.getByText(/Forked — new session created/)).toBeInTheDocument();
  });

  it("forwards the Switch / Resume / Fork actions", async () => {
    const handlers = renderDetail();
    await waitFor(() => expect(screen.getByRole("button", { name: /^Switch$/ })).toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: /^Switch$/ }));
    await userEvent.click(screen.getByRole("button", { name: /^Resume$/ }));
    await userEvent.click(screen.getByRole("button", { name: /^Fork$/ }));

    expect(handlers.onSwitch).toHaveBeenCalledTimes(1);
    expect(handlers.onResume).toHaveBeenCalledTimes(1);
    expect(handlers.onFork).toHaveBeenCalledTimes(1);
  });

  it("renders friendly empty states when there is no data", async () => {
    (mockClient.getTranscript as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (mockClient.getContextStats as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    (mockClient.getState as ReturnType<typeof vi.fn>).mockResolvedValue({ goals: [], rlmChildren: [] });

    renderDetail();
    await waitFor(() => expect(screen.getByText("No active goals")).toBeInTheDocument());
    expect(screen.getByText("No active subagents")).toBeInTheDocument();
    expect(screen.getByText("No transcript available")).toBeInTheDocument();
    expect(screen.getByText("No context data available")).toBeInTheDocument();
  });
});
