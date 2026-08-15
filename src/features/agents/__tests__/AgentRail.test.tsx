// AgentRail.test.tsx — the left rail of the Agents command center. Covers
// grouping (daemon vs RLM), selection, attach/detach, unread badges, and the
// loading / error / empty states.

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AgentRail } from "../AgentRail";
import type { AgentRow } from "../useAgents";

const daemon: AgentRow = { id: "a-1", name: "Reviewer", kind: "daemon", status: "running", summary: "Checking PRs", model: "deepseek" };
const rlm: AgentRow = { id: "r-1", name: "critic", kind: "rlm", status: "done", parentId: "a-1", summary: "reviewed" };

function renderRail({
  agents = [daemon, rlm],
  selectedId,
  loading = false,
  error,
  attachedId,
  runtimeModel,
}: {
  agents?: AgentRow[];
  selectedId?: string;
  loading?: boolean;
  error?: string;
  attachedId?: string;
  runtimeModel?: string;
} = {}) {
  const handlers = {
    onAttach: vi.fn(),
    onDetach: vi.fn(),
    onSelect: vi.fn(),
    onRetry: vi.fn(),
    unreadByAgent: vi.fn((id: string) => (id === "a-1" ? 2 : 0)),
  };
  const utils = render(
    <AgentRail
      agents={agents}
      selectedId={selectedId}
      loading={loading}
      error={error}
      attachedId={attachedId}
      runtimeModel={runtimeModel}
      onAttach={handlers.onAttach}
      onDetach={handlers.onDetach}
      onSelect={handlers.onSelect}
      unreadByAgent={handlers.unreadByAgent}
      onRetry={handlers.onRetry}
    />,
  );
  return { handlers, ...utils };
}

describe("AgentRail", () => {
  it("renders the fleet header with a zero-padded count", () => {
    renderRail();
    expect(screen.getByText("AGENT FLEET")).toBeInTheDocument();
    expect(screen.getByText("02")).toBeInTheDocument();
  });

  it("groups daemon agents and RLM children under separate labels", () => {
    renderRail();
    expect(screen.getAllByText("Daemon").length).toBeGreaterThan(0);
    expect(screen.getByText("RLM children")).toBeInTheDocument();
    expect(screen.getByText("Reviewer")).toBeInTheDocument();
    expect(screen.getByText("critic")).toBeInTheDocument();
  });

  it("shows the agent summary and model", () => {
    renderRail();
    expect(screen.getByText("Checking PRs")).toBeInTheDocument();
    expect(screen.getByText("deepseek")).toBeInTheDocument();
  });

  it("shows the unread badge per agent", () => {
    renderRail();
    expect(screen.getByTitle("2 unread")).toHaveTextContent("2");
  });

  it("calls onSelect when a row is clicked", async () => {
    const user = userEvent.setup();
    const { handlers } = renderRail();
    await user.click(screen.getByRole("button", { name: "Reviewer" }));
    expect(handlers.onSelect).toHaveBeenCalledWith("a-1");
  });

  it("marks the selected row with aria-current=page", () => {
    renderRail({ selectedId: "a-1" });
    expect(screen.getByRole("button", { name: "Reviewer" })).toHaveAttribute("aria-current", "page");
  });

  it("renders an attach action for an unattached agent and detach when attached", async () => {
    const user = userEvent.setup();
    const { handlers } = renderRail({ attachedId: "a-1" });
    // Detach icon is shown for the attached daemon.
    const detachBtn = screen.getByTitle("Stop monitoring");
    expect(detachBtn).toBeInTheDocument();
    await user.click(detachBtn);
    expect(handlers.onDetach).toHaveBeenCalledWith("a-1");
  });

  it("calls onAttach for an unattached agent", async () => {
    const user = userEvent.setup();
    const { handlers } = renderRail({ agents: [rlm] });
    await user.click(screen.getByTitle("Attach to relay"));
    expect(handlers.onAttach).toHaveBeenCalledWith("r-1");
  });

  it("renders a skeleton while loading", () => {
    renderRail({ loading: true });
    expect(screen.getAllByText(/Agent/i)).toBeDefined();
    expect(screen.queryByText("Reviewer")).not.toBeInTheDocument();
    expect(screen.getByText("AGENT FLEET")).toBeInTheDocument();
  });

  it("renders the empty state when there are no agents", () => {
    renderRail({ agents: [] });
    expect(screen.getByText("No agents in range")).toBeInTheDocument();
  });

  it("renders an error with a working Retry", async () => {
    const user = userEvent.setup();
    const { handlers } = renderRail({ error: "relay down" });
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("relay down");
    await user.click(screen.getByRole("button", { name: /retry/i }));
    expect(handlers.onRetry).toHaveBeenCalledTimes(1);
  });

  it("renders the status legend footer", () => {
    renderRail();
    expect(screen.getByText("running")).toBeInTheDocument();
    expect(screen.getByText("idle")).toBeInTheDocument();
    expect(screen.getByText("error")).toBeInTheDocument();
  });
});
