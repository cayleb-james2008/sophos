// RefinementHistory — review-and-approve gate panel. Reads the shared module-
// level gate store (reset per test via vi.resetModules + dynamic import) and
// drives refine passes through ipc.refine() / ipc.prompt().

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockClient = vi.hoisted(() => ({
  refine: vi.fn(),
  prompt: vi.fn(),
}));

vi.mock("../../../ipc/client", () => ({
  useIpc: () => mockClient,
  useIpcEvent: () => undefined,
  useConnectionState: () => ({ status: { kind: "connected" } }),
}));

type GateModule = typeof import("../useRefinementGate");
type HistoryModule = typeof import("../RefinementHistory");
let gateMod: GateModule;
let HistoryMod: HistoryModule;

beforeEach(async () => {
  window.localStorage.removeItem("sophos.refineAutoApply.v1");
  vi.resetModules();
  gateMod = await import("../useRefinementGate");
  HistoryMod = await import("../RefinementHistory");
  vi.clearAllMocks();
  (mockClient.refine as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
  (mockClient.prompt as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
});

const resultWithEdits = (id: string, summary: string) => ({
  id,
  summary,
  appliedEdits: [{ id: "e-1", action: "update", kind: "instruction", title: "src/x.ts", applied: false }],
});

describe("RefinementHistory", () => {
  it("shows an empty state when nothing is recorded and nothing is pending", () => {
    render(<HistoryMod.RefinementHistory />);
    expect(screen.getByText(/no refinements yet/i)).toBeInTheDocument();
    expect(screen.getByText("0 recorded")).toBeInTheDocument();
  });

  it("runs a bare refine pass via ipc.refine when no instructions are given", async () => {
    const user = userEvent.setup();
    render(<HistoryMod.RefinementHistory />);
    await user.click(screen.getByRole("button", { name: /refine now/i }));
    await waitFor(() => expect(mockClient.refine).toHaveBeenCalled());
    expect(mockClient.prompt).not.toHaveBeenCalled();
  });

  it("routes instructed refinement through ipc.prompt('/refine <text>')", async () => {
    const user = userEvent.setup();
    render(<HistoryMod.RefinementHistory />);
    await user.type(screen.getByLabelText("Instructions (optional)"), "preserve the tests");
    await user.click(screen.getByRole("button", { name: /refine now/i }));
    await waitFor(() => expect(mockClient.prompt).toHaveBeenCalledWith("/refine preserve the tests"));
    expect(mockClient.refine).not.toHaveBeenCalled();
    // Input is cleared after the pass.
    expect((screen.getByLabelText("Instructions (optional)") as HTMLInputElement).value).toBe("");
  });

  it("surfaces an error when a bare refine fails", async () => {
    const user = userEvent.setup();
    (mockClient.refine as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("no active daemon connection"));
    render(<HistoryMod.RefinementHistory />);
    await user.click(screen.getByRole("button", { name: /refine now/i }));
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(screen.getByText(/no active daemon connection/i)).toBeInTheDocument();
  });

  it("shows a pending proposal with Apply/Discard", async () => {
    gateMod.handleRefinementResult(resultWithEdits("r1", "Fix the renderer"));
    render(<HistoryMod.RefinementHistory />);
    expect(screen.getByText(/proposed refinement — awaiting your review/i)).toBeInTheDocument();
    expect(screen.getByText("Fix the renderer")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /apply/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /discard/i })).toBeInTheDocument();
    expect(screen.getByText("1 awaiting review")).toBeInTheDocument();
  });

  it("applying a pending proposal records it in the history as Applied", async () => {
    const user = userEvent.setup();
    gateMod.handleRefinementResult(resultWithEdits("r2", "Applied pass"));
    render(<HistoryMod.RefinementHistory />);
    await user.click(screen.getByRole("button", { name: /apply/i }));
    await waitFor(() => expect(screen.getByText("Applied")).toBeInTheDocument());
    expect(screen.queryByText(/proposed refinement/i)).not.toBeInTheDocument();
  });

  it("toggles auto-apply and reflects it in the switch", async () => {
    const user = userEvent.setup();
    render(<HistoryMod.RefinementHistory />);
    const toggle = screen.getByRole("switch");
    expect(toggle).toHaveAttribute("aria-checked", "false");
    await user.click(toggle);
    await waitFor(() => expect(toggle).toHaveAttribute("aria-checked", "true"));
  });

  it("renders seeded history entries with their status badges", () => {
    render(
      <HistoryMod.RefinementHistory
        initial={[
          { id: "h1", timestamp: "2026-01-15T10:00:00.000Z", description: "Tighten goal", status: "applied" },
          { id: "h2", timestamp: "2026-01-15T11:00:00.000Z", description: "Rejected idea", status: "discarded" },
          { id: "h3", timestamp: "2026-01-15T12:00:00.000Z", description: "Bad change", status: "rolled-back" },
        ]}
      />,
    );
    expect(screen.getByText("3 recorded")).toBeInTheDocument();
    expect(screen.getByText("Tighten goal")).toBeInTheDocument();
    expect(screen.getByText("Rejected idea")).toBeInTheDocument();
    expect(screen.getByText("Bad change")).toBeInTheDocument();
    expect(screen.getAllByText("Applied").length).toBeGreaterThan(0);
    expect(screen.getByText("Discarded")).toBeInTheDocument();
    expect(screen.getByText("Rolled back")).toBeInTheDocument();
  });

  it("rolls back an applied refinement via prompt and marks it rolled back", async () => {
    const user = userEvent.setup();
    gateMod.handleRefinementResult(resultWithEdits("r9", "Applied then rolled back"));
    render(<HistoryMod.RefinementHistory />);
    await user.click(screen.getByRole("button", { name: /apply/i }));
    await waitFor(() => expect(screen.getByText("Applied")).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: /rollback this refinement/i }));
    await waitFor(() => expect(mockClient.prompt).toHaveBeenCalledWith("/refine rollback r9"));
    await waitFor(() => expect(screen.getByText("Rolled back")).toBeInTheDocument());
  });
});
