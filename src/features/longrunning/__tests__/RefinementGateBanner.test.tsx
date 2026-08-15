// RefinementGateBanner — always-visible review gate for a pending refinement
// proposal. Reads the shared module-level gate store, so the store is reset
// (vi.resetModules + dynamic import) before each test and driven through its
// exported handleRefinementResult().

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockClient = vi.hoisted(() => ({
  refine: vi.fn(),
  prompt: vi.fn(),
}));

vi.mock("../../../ipc/client", () => ({
  useIpc: () => mockClient,
  useIpcEvent: () => undefined,
}));

type GateModule = typeof import("../useRefinementGate");
type BannerModule = typeof import("../RefinementGateBanner");
let gateMod: GateModule;
let BannerMod: BannerModule;

beforeEach(async () => {
  window.localStorage.removeItem("sophos.refineAutoApply.v1");
  vi.resetModules();
  gateMod = await import("../useRefinementGate");
  BannerMod = await import("../RefinementGateBanner");
});

const resultWithEdits = (id: string, summary: string) => ({
  id,
  summary,
  appliedEdits: [{ id: "e-1", action: "update", kind: "instruction", title: "src/x.ts", applied: false }],
});

describe("RefinementGateBanner", () => {
  it("renders nothing when no refinement is pending", () => {
    render(<BannerMod.RefinementGateBanner />);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("renders the pending proposal with summary, Apply, and Discard", () => {
    gateMod.handleRefinementResult(resultWithEdits("r1", "Fix the diff renderer"));
    render(<BannerMod.RefinementGateBanner />);
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByText(/refinement awaiting your review/i)).toBeInTheDocument();
    expect(screen.getByText("Fix the diff renderer")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /apply/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /discard/i })).toBeInTheDocument();
  });

  it("collapses the diff by default and expands it on toggle", async () => {
    const user = userEvent.setup();
    gateMod.handleRefinementResult(resultWithEdits("r2", "Tighten instructions"));
    render(<BannerMod.RefinementGateBanner />);

    const toggle = screen.getByRole("button", { name: /show diff/i });
    expect(toggle).toBeInTheDocument();
    // Diff is collapsed by default.
    expect(screen.queryByText("@@ src/x.ts @@")).not.toBeInTheDocument();

    await user.click(toggle);
    expect(screen.getByRole("button", { name: /hide diff/i })).toBeInTheDocument();
    expect(screen.getByText("@@ src/x.ts @@")).toBeInTheDocument();
  });

  it("omits the diff toggle when the proposal carries no edits", () => {
    gateMod.handleRefinementResult({ id: "r3", summary: "No edits" });
    render(<BannerMod.RefinementGateBanner />);
    expect(screen.getByText("No edits")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /show diff/i })).not.toBeInTheDocument();
  });

  it("Apply clears the pending proposal from the banner", async () => {
    const user = userEvent.setup();
    gateMod.handleRefinementResult(resultWithEdits("r4", "Apply me"));
    render(<BannerMod.RefinementGateBanner />);
    await user.click(screen.getByRole("button", { name: /apply/i }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("Discard clears the pending proposal from the banner", async () => {
    const user = userEvent.setup();
    gateMod.handleRefinementResult(resultWithEdits("r5", "Discard me"));
    render(<BannerMod.RefinementGateBanner />);
    await user.click(screen.getByRole("button", { name: /discard/i }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
