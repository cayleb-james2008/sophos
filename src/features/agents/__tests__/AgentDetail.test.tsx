// AgentDetail.test.tsx — the right-hand inspector for a selected agent. Covers
// the standby state, header + telemetry grid, attach/detach actions, runtime
// model fallback, live session state, and the delivery receipt.

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AgentDetail } from "../AgentDetail";
import type { AgentRow } from "../useAgents";
import type { AgentMessage, AgentMessageReceipt, AgentSessionState } from "../../../ipc/contract";

const mockClient = vi.hoisted(() => ({
  getRuntimeInfo: vi.fn(),
  getSettings: vi.fn(),
}));

vi.mock("../../../ipc/client", async () => ({
  useIpc: () => mockClient,
}));

const AGENT: AgentRow = {
  id: "agent-12345678",
  name: "Reviewer",
  kind: "daemon",
  status: "running",
  model: "deepseek-v4",
  sessionId: "session-9",
  parentId: "parent-1",
  summary: "Reviewing the merge",
};

const THREAD: AgentMessage[] = [
  { id: "m1", fromAgentId: "agent-12345678", toAgentId: "self", text: "on it", timestamp: "2026-01-01T10:00:00.000Z", read: false },
];

const STATE: AgentSessionState = {
  id: "agent-12345678",
  status: "running",
  activity: "checking tests",
  tokenCount: 1200,
  transcript: [
    { id: "t1", role: "assistant", content: "working", timestamp: "2026-01-01T10:00:00.000Z" },
    { id: "t2", role: "tool", content: "", timestamp: "2026-01-01T10:01:00.000Z" },
  ],
};

function renderDetail({
  agent = AGENT,
  runtimeModel,
  attached = false,
  sessionState,
  deliveryReceipt,
}: {
  agent?: AgentRow | null;
  runtimeModel?: string;
  attached?: boolean;
  sessionState?: AgentSessionState;
  deliveryReceipt?: AgentMessageReceipt;
} = {}) {
  const handlers = {
    onAttach: vi.fn(),
    onDetach: vi.fn(),
    setDraft: vi.fn(),
    onSend: vi.fn(),
    onMarkRead: vi.fn(),
    onMarkAllRead: vi.fn(),
  };
  const utils = render(
    <AgentDetail
      agent={agent ?? null}
      runtimeModel={runtimeModel}
      attached={attached}
      sessionState={sessionState}
      onAttach={handlers.onAttach}
      onDetach={handlers.onDetach}
      thread={THREAD}
      unreadCount={1}
      draft=""
      setDraft={handlers.setDraft}
      sending={false}
      deliveryReceipt={deliveryReceipt}
      onSend={handlers.onSend}
      onMarkRead={handlers.onMarkRead}
      onMarkAllRead={handlers.onMarkAllRead}
    />,
  );
  return { handlers, ...utils };
}

beforeEach(() => {
  vi.clearAllMocks();
  (mockClient.getRuntimeInfo as ReturnType<typeof vi.fn>).mockResolvedValue({ skills: [] });
  (mockClient.getSettings as ReturnType<typeof vi.fn>).mockResolvedValue({});
});

describe("AgentDetail", () => {
  it("shows the standby prompt when no agent is selected", () => {
    renderDetail({ agent: null });
    expect(screen.getAllByText("No agent selected").length).toBeGreaterThan(0);
    expect(screen.getByText(/Choose an agent from the rail/i)).toBeInTheDocument();
  });

  it("renders the agent header with name, status label, and id", () => {
    renderDetail();
    expect(screen.getAllByText("Reviewer").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Running").length).toBeGreaterThan(0);
    expect(screen.getByText("Daemon agent")).toBeInTheDocument();
    expect(screen.getByText("AGENT / AGENT-12")).toBeInTheDocument();
  });

  it("renders the telemetry rows", () => {
    renderDetail();
    expect(screen.getByText("Daemon-backed agent")).toBeInTheDocument();
    expect(screen.getByText("Running")).toBeInTheDocument();
    expect(screen.getByText("deepseek-v4")).toBeInTheDocument();
    expect(screen.getByText("session-9")).toBeInTheDocument();
    expect(screen.getByText("parent-1")).toBeInTheDocument();
    expect(screen.getByText("Reviewing the merge")).toBeInTheDocument();
  });

  it("shows the runtime model fallback when the agent has no model", () => {
    renderDetail({ agent: { ...AGENT, model: undefined }, runtimeModel: "fallback-model" });
    expect(screen.getByText("fallback-model")).toBeInTheDocument();
  });

  it("renders Attach when not attached and Detach when attached", async () => {
    const user = userEvent.setup();
    const { handlers } = renderDetail();
    await user.click(screen.getByRole("button", { name: /attach/i }));
    expect(handlers.onAttach).toHaveBeenCalledTimes(1);
  });

  it("renders Detach when attached and calls onDetach", async () => {
    const user = userEvent.setup();
    const { handlers } = renderDetail({ attached: true });
    await user.click(screen.getByRole("button", { name: /detach/i }));
    expect(handlers.onDetach).toHaveBeenCalledTimes(1);
  });

  it("renders the live session state block with transcript length", () => {
    renderDetail({ sessionState: STATE });
    expect(screen.getByText(/LIVE SESSION STATE · 2 messages/i)).toBeInTheDocument();
    // Tool activity content falls back to a placeholder label.
    expect(screen.getByText("(tool activity)")).toBeInTheDocument();
  });

  it("renders the delivery receipt when one is present", () => {
    const receipt: AgentMessageReceipt = {
      id: "rec-1",
      target: { activeSessionId: "agent-12345678", sessionId: "agent-12345678" },
      message: "hi",
      deliveryStatus: "delivered",
    };
    renderDetail({ deliveryReceipt: receipt });
    expect(screen.getByRole("status")).toHaveTextContent(/delivered to the child/i);
  });
});
