// AgentsView.test.tsx — the Agents command center shell. Mocks useAgents and
// the graph/detail children to isolate the header telemetry, the connection
// error banner, and the degraded (loading / error / empty) overlays.

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AgentsView } from "../AgentsView";
import type { AgentRow } from "../useAgents";

const mockHook = vi.hoisted(() => vi.fn());

vi.mock("../useAgents", async () => {
  return {
    useAgents: () => mockHook(),
  };
});

vi.mock("../AgentsGraph", () => ({
  AgentsGraph: () => <div data-testid="agents-graph" />,
}));

vi.mock("../AgentDetail", () => ({
  AgentDetail: () => <div data-testid="agent-detail" />,
}));

const daemon: AgentRow = { id: "a-1", name: "Reviewer", kind: "daemon", status: "running" };

function makeHook(overrides: Partial<Record<string, unknown>> = {}) {
  const base = {
    rows: [daemon],
    selected: daemon,
    selectedId: "a-1",
    selectedAgentState: undefined,
    setSelectedId: vi.fn(),
    thread: [],
    attachedIds: [],
    attach: vi.fn(),
    detach: vi.fn(),
    draft: "",
    setDraft: vi.fn(),
    send: vi.fn(),
    sending: false,
    deliveryReceipt: undefined,
    markRead: vi.fn(),
    markAllRead: vi.fn(),
    markAgentRead: vi.fn(),
    unreadByAgent: vi.fn(() => 0),
    totalUnread: 0,
    loading: false,
    error: undefined,
    refresh: vi.fn(),
    runtimeModel: "deepseek",
    connectionStatus: { kind: "connected" },
    connectionModel: { provider: "ollama-cloud", model: "deepseek-v4" },
    ...overrides,
  };
  return base;
}

describe("AgentsView", () => {
  function telemetry(text: string) {
    return screen.getAllByText((_c: string, el: Element | null) =>
      el?.textContent?.replace(/\s+/g, " ").trim() === text,
    );
  }

  it("renders the header with running / total / unread telemetry", () => {
    mockHook.mockReturnValue(makeHook({ totalUnread: 2 }));
    render(<AgentsView />);
    expect(screen.getByText("Agent command center")).toBeInTheDocument();
    expect(telemetry("1 running").length).toBeGreaterThan(0);
    expect(telemetry("1 total").length).toBeGreaterThan(0);
    expect(telemetry("2 unread").length).toBeGreaterThan(0);
  });

  it("shows the connection status and runtime model", () => {
    mockHook.mockReturnValue(makeHook());
    render(<AgentsView />);
    expect(screen.getByText("connected")).toBeInTheDocument();
    expect(screen.getByText("RUNTIME MODEL")).toBeInTheDocument();
    expect(screen.getByText("deepseek-v4")).toBeInTheDocument();
    expect(screen.getByText("ollama-cloud")).toBeInTheDocument();
  });

  it("refreshes when the Refresh button is clicked", async () => {
    const user = userEvent.setup();
    const hook = makeHook();
    mockHook.mockReturnValue(hook);
    render(<AgentsView />);
    await user.click(screen.getByRole("button", { name: /refresh/i }));
    expect(hook.refresh).toHaveBeenCalledTimes(1);
  });

  it("shows the scanning overlay while loading with no agents", () => {
    mockHook.mockReturnValue(makeHook({ loading: true, rows: [], selected: undefined }));
    render(<AgentsView />);
    expect(screen.getAllByText("Scanning the relay…").length).toBeGreaterThan(0);
  });

  it("shows the fleet unavailable state with a working retry when an error occurs and no agents exist", async () => {
    const user = userEvent.setup();
    const hook = makeHook({ error: "pipe down", rows: [], selected: undefined });
    mockHook.mockReturnValue(hook);
    render(<AgentsView />);
    expect(screen.getByText("Fleet unavailable")).toBeInTheDocument();
    expect(screen.getAllByText("pipe down").length).toBeGreaterThan(0);
    await user.click(screen.getAllByRole("button", { name: /retry/i })[1]);
    expect(hook.refresh).toHaveBeenCalledTimes(1);
  });

  it("shows the empty state when there are no agents and no error", () => {
    mockHook.mockReturnValue(makeHook({ rows: [], selected: undefined, loading: false }));
    render(<AgentsView />);
    expect(screen.getByText("No agents in range")).toBeInTheDocument();
  });

  it("shows the connection error banner with the degraded message", async () => {
    const user = userEvent.setup();
    const hook = makeHook({ error: "relay degraded", rows: [daemon] });
    mockHook.mockReturnValue(hook);
    render(<AgentsView />);
    const banner = screen.getByRole("alert");
    expect(banner).toHaveTextContent(/Agent relay degraded — relay degraded/i);
    await user.click(screen.getByRole("button", { name: /retry/i }));
    expect(hook.refresh).toHaveBeenCalledTimes(1);
  });

  it("renders the graph when not loading", () => {
    mockHook.mockReturnValue(makeHook());
    render(<AgentsView />);
    expect(screen.getByTestId("agents-graph")).toBeInTheDocument();
    expect(screen.getByTestId("agent-detail")).toBeInTheDocument();
  });
});
