// SessionCard.test.tsx — a row in the session rail. Pure presentational: it
// takes session + enrichment props and surfaces callbacks for select / switch /
// resume / fork. These tests cover the rendered pragma, the status/selected
// classes, the context-usage chip (incl. danger), goal + RLM-child counts, and
// the keyboard/click activation paths.

import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { SessionInfo, ContextStats, Goal, RlmChild } from "../../../ipc/contract";
import { SessionCard } from "../SessionCard";

const baseSession: SessionInfo = {
  id: "s-1",
  title: "Refactor auth",
  status: "active",
  cwd: "C:\\work\\api-service\\src",
  createdAt: new Date("2026-01-15T10:00:00.000Z").toISOString(),
  updatedAt: new Date("2026-01-15T11:00:00.000Z").toISOString(),
};

function renderCard({
  session = baseSession,
  model,
  context,
  goals,
  rlmChildren,
  selected = false,
}: {
  session?: SessionInfo;
  model?: string;
  context?: ContextStats;
  goals?: Goal[];
  rlmChildren?: RlmChild[];
  selected?: boolean;
} = {}) {
  const handlers = { onSelect: vi.fn(), onSwitch: vi.fn(), onResume: vi.fn(), onFork: vi.fn() };
  render(
    <SessionCard
      session={session}
      model={model}
      context={context}
      goals={goals}
      rlmChildren={rlmChildren}
      selected={selected}
      onSelect={handlers.onSelect}
      onSwitch={handlers.onSwitch}
      onResume={handlers.onResume}
      onFork={handlers.onFork}
    />,
  );
  return handlers;
}

describe("SessionCard", () => {
  it("renders the title, model pragma, and short cwd path", () => {
    renderCard({ model: "gpt-4o" });
    expect(screen.getByText("Refactor auth")).toBeInTheDocument();
    // pragma = "gpt-4o · 1h · .../api-service/src"
    expect(screen.getByText(/gpt-4o/)).toBeInTheDocument();
    expect(screen.getByText(/1h/)).toBeInTheDocument();
    expect(screen.getByText(/\.\.\.\/api-service\/src/)).toBeInTheDocument();
  });

  it("falls back to the session id when the title is missing", () => {
    renderCard({ session: { ...baseSession, title: "" } });
    expect(screen.getByText("s-1")).toBeInTheDocument();
  });

  it("applies active and selected classes", () => {
    renderCard({ selected: true });
    const row = document.querySelector(".session")!;
    expect(row.className).toContain("session--active");
    expect(row.className).toContain("session--selected");
  });

  it("applies the saved class for a saved session", () => {
    renderCard({ session: { ...baseSession, status: "saved" } });
    expect(document.querySelector(".session")!.className).toContain("session--saved");
  });

  it("clicking the row invokes onSelect", async () => {
    const handlers = renderCard();
    await userEvent.click(screen.getByRole("button", { name: /refactor auth/i }));
    expect(handlers.onSelect).toHaveBeenCalledTimes(1);
  });

  it("activates onSelect with Enter and Space keys", () => {
    const handlers = renderCard();
    const row = document.querySelector(".session")!;
    fireEvent.keyDown(row, { key: "Enter" });
    expect(handlers.onSelect).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(row, { key: " " });
    expect(handlers.onSelect).toHaveBeenCalledTimes(2);
  });

  it("Switch / Resume / Fork call their handlers without selecting the row", async () => {
    const handlers = renderCard();
    await userEvent.click(screen.getByTitle("Switch to session"));
    await userEvent.click(screen.getByTitle("Resume session"));
    await userEvent.click(screen.getByTitle("Fork session"));

    expect(handlers.onSwitch).toHaveBeenCalledTimes(1);
    expect(handlers.onResume).toHaveBeenCalledTimes(1);
    expect(handlers.onFork).toHaveBeenCalledTimes(1);
    // The action buttons stop propagation, so the row select must not fire.
    expect(handlers.onSelect).not.toHaveBeenCalled();
  });

  it("renders the context-usage chip with tokens when context stats are present", () => {
    renderCard({ context: { tokens: 2500, contextWindow: 10000 } });
    expect(screen.getByText("2.5k/10.0k")).toBeInTheDocument();
  });

  it("flags the context chip as danger above 80%", () => {
    renderCard({ context: { tokens: 9000, contextWindow: 10000 } });
    expect(document.querySelector(".session__ctx--danger")).not.toBeNull();
  });

  it("shows the active-goal count and RLM-child count chips", () => {
    const goals: Goal[] = [
      { id: "g1", objective: "one", status: "active" },
      { id: "g2", objective: "two", status: "completed" },
    ];
    const rlmChildren: RlmChild[] = [{ id: "r1", name: "reviewer", status: "running" }];
    renderCard({ goals, rlmChildren });
    expect(screen.getByTitle("1 active goal")).toBeInTheDocument();
    expect(screen.getByTitle("1 RLM child")).toBeInTheDocument();
  });

  it("omits the chips block when there is no context, goals, or children", () => {
    renderCard();
    expect(document.querySelector(".session__chips")).toBeNull();
  });
});
