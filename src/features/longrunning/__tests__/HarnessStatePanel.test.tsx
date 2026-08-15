// HarnessStatePanel — live continual harness state with kind filtering and
// rollback routing. Mocks useIpc so getHarnessState() and prompt() drive the
// panel deterministically.

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { HarnessStatePanel } from "../HarnessStatePanel";

const mockClient = vi.hoisted(() => ({
  getHarnessState: vi.fn(),
  prompt: vi.fn(),
}));

vi.mock("../../../ipc/client", () => ({
  useIpc: () => mockClient,
}));

const harnessState = {
  source: "daemon-owned state",
  entries: [
    { id: "e1", kind: "memory", title: "Memory A", content: "A durable fact", scope: "local", version: 3 },
    { id: "e2", kind: "skill", title: "Skill B", content: "A reusable skill", reference: { path: "skills/b" }, version: 1 },
    { id: "e3", kind: "prompt", title: "Prompt C", content: "A prompt addendum" },
  ],
  refinements: [
    { id: "r1", summary: "Tighten instructions", timestamp: "2026-01-15T10:00:00.000Z" },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  (mockClient.getHarnessState as ReturnType<typeof vi.fn>).mockResolvedValue({ ...harnessState, entries: harnessState.entries.map((e) => ({ ...e })), refinements: harnessState.refinements.map((r) => ({ ...r })) });
  (mockClient.prompt as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
});

describe("HarnessStatePanel", () => {
  it("loads and renders the harness state with source and entries", async () => {
    render(<HarnessStatePanel />);
    await waitFor(() => expect(screen.getByText("Memory A")).toBeInTheDocument());
    expect(screen.getByText("daemon-owned state")).toBeInTheDocument();
    expect(screen.getByText("Skill B")).toBeInTheDocument();
    expect(screen.getByText("Prompt C")).toBeInTheDocument();
    // Scope and kind badges — two entries are global, one is local.
    expect(screen.getByText("local")).toBeInTheDocument();
    expect(screen.getAllByText("global")).toHaveLength(2);
    expect(screen.getByText("v3")).toBeInTheDocument();
  });

  it("filters entries by kind", async () => {
    const user = userEvent.setup();
    render(<HarnessStatePanel />);
    await waitFor(() => expect(screen.getByText("Memory A")).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: /^skill · 1$/ }));
    expect(screen.queryByText("Memory A")).not.toBeInTheDocument();
    expect(screen.getByText("Skill B")).toBeInTheDocument();
    expect(screen.queryByText("Prompt C")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /^all · 3$/i }));
    await waitFor(() => expect(screen.getByText("Memory A")).toBeInTheDocument());
  });

  it("shows an empty state when there are no entries in the current scope", async () => {
    (mockClient.getHarnessState as ReturnType<typeof vi.fn>).mockResolvedValue({ source: "daemon", entries: [], refinements: [] });
    render(<HarnessStatePanel />);
    await waitFor(() => expect(screen.getByText(/no saved entries in this scope yet/i)).toBeInTheDocument());
  });

  it("surfaces a load error", async () => {
    (mockClient.getHarnessState as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("harness down"));
    render(<HarnessStatePanel />);
    await waitFor(() => expect(screen.getByText(/harness down/i)).toBeInTheDocument());
  });

  it("renders refinement history and routes rollback through the prompt system", async () => {
    const user = userEvent.setup();
    render(<HarnessStatePanel />);
    await waitFor(() => expect(screen.getByText("Tighten instructions")).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: /^rollback$/i }));
    await waitFor(() => expect(mockClient.prompt).toHaveBeenCalledWith("/refine rollback r1", expect.objectContaining({ queueIfBusy: true })));
  });

  it("surfaces an error when a rollback request fails", async () => {
    const user = userEvent.setup();
    (mockClient.prompt as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("rollback rejected"));
    render(<HarnessStatePanel />);
    await waitFor(() => expect(screen.getByText("Tighten instructions")).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: /^rollback$/i }));
    await waitFor(() => expect(screen.getByText(/rollback rejected/i)).toBeInTheDocument());
  });

  it("renders an empty refinements note when none exist", async () => {
    (mockClient.getHarnessState as ReturnType<typeof vi.fn>).mockResolvedValue({ source: "daemon", entries: [], refinements: [] });
    render(<HarnessStatePanel />);
    await waitFor(() => expect(screen.getByText(/no daemon refinement records yet/i)).toBeInTheDocument());
  });
});
