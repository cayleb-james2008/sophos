// InboxThread.test.tsx — the coordination thread between SELF and an agent.
// Covers the standby (no agent), empty, and populated states, outgoing vs
// incoming styling, unread markers, per-message mark-read, and mark-all-read.

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { InboxThread } from "../InboxThread";
import type { AgentMessage } from "../../../ipc/contract";
import type { AgentRow } from "../useAgents";

const AGENT: AgentRow = { id: "agent-x", name: "Worker", kind: "daemon", status: "running" };

const MESSAGES: AgentMessage[] = [
  { id: "m1", fromAgentId: "agent-x", fromAgentName: "Worker", toAgentId: "self", text: "Hello from the child", timestamp: "2026-01-01T10:00:00.000Z", read: false },
  { id: "m2", fromAgentId: "self", fromAgentName: "You", toAgentId: "agent-x", text: "Please proceed", timestamp: "2026-01-01T10:05:00.000Z", read: true },
];

function renderThread({
  agent = AGENT,
  messages = MESSAGES,
  unreadCount,
}: {
  agent?: AgentRow | null;
  messages?: AgentMessage[];
  unreadCount?: number;
} = {}) {
  const handlers = { onMarkRead: vi.fn(), onMarkAllRead: vi.fn() };
  const utils = render(
    <InboxThread
      agent={agent}
      messages={messages}
      unreadCount={unreadCount ?? messages.filter((m) => m.fromAgentId !== "self" && m.read !== true).length}
      onMarkRead={handlers.onMarkRead}
      onMarkAllRead={handlers.onMarkAllRead}
    />,
  );
  return { handlers, ...utils };
}

describe("InboxThread", () => {
  it("shows the standby state when no agent is selected", () => {
    renderThread({ agent: null, messages: [] });
    expect(screen.getByText("No agent selected")).toBeInTheDocument();
    expect(screen.getByText("Agent relay standing by")).toBeInTheDocument();
  });

  it("shows the empty state when an agent is selected but has no messages", () => {
    renderThread({ messages: [] });
    expect(screen.getByText("Open a coordination line")).toBeInTheDocument();
  });

  it("renders the thread header with the agent name and status", () => {
    renderThread();
    expect(screen.getAllByText("Worker").length).toBeGreaterThan(0);
    expect(screen.getByText(/running · daemon channel/i)).toBeInTheDocument();
  });

  it("renders both incoming and outgoing messages with their text", () => {
    renderThread();
    expect(screen.getByText("Hello from the child")).toBeInTheDocument();
    expect(screen.getByText("Please proceed")).toBeInTheDocument();
    expect(screen.getByText("YOU")).toBeInTheDocument();
  });

  it("labels unread incoming messages with UNREAD", () => {
    renderThread();
    expect(screen.getByText(/UNREAD/i)).toBeInTheDocument();
  });

  it("provides a mark-read control for an unread incoming message", async () => {
    const user = userEvent.setup();
    const { handlers } = renderThread();
    await user.click(screen.getByTitle("Mark message as read"));
    expect(handlers.onMarkRead).toHaveBeenCalledWith("m1");
  });

  it("shows a mark-all-read button with the unread count", async () => {
    const user = userEvent.setup();
    const { handlers } = renderThread({ unreadCount: 1 });
    const btn = screen.getByRole("button", { name: /mark all read/i });
    expect(btn).toHaveTextContent("1");
    await user.click(btn);
    expect(handlers.onMarkAllRead).toHaveBeenCalledTimes(1);
  });

  it("does not render mark-all-read when there is nothing unread", () => {
    renderThread({ unreadCount: 0 });
    expect(screen.queryByRole("button", { name: /mark all read/i })).not.toBeInTheDocument();
  });
});
