// useRefinementGate — hook tests for the shared review-and-approve refinement
// gate. The gate is a module-level singleton store, so we reset the module
// before each test to keep pending/history state isolated.

import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

type GateModule = typeof import("../useRefinementGate");
let mod: GateModule;

beforeEach(async () => {
  window.localStorage.removeItem("sophos.refineAutoApply.v1");
  vi.resetModules();
  mod = await import("../useRefinementGate");
});

const refineResult = (id: string, summary: string) => ({
  id,
  summary,
  appliedEdits: [{ id: "e-1", action: "edit", kind: "update", title: "src/x.ts", applied: true }],
});

describe("useRefinementGate", () => {
  it("starts idle: no pending proposal, empty history, auto-apply off", () => {
    const { result } = renderHook(() => mod.useRefinementGate());
    expect(result.current.pending).toBeNull();
    expect(result.current.history).toEqual([]);
    expect(result.current.autoApply).toBe(false);
  });

  it("holds a pending proposal when a refinement result arrives, then applies it", async () => {
    const { result } = renderHook(() => mod.useRefinementGate());
    await waitFor(() => expect(result.current.autoApply).toBe(false));

    act(() => {
      mod.handleRefinementResult(refineResult("r-1", "Fix the diff renderer"));
    });
    await waitFor(() => expect(result.current.pending).not.toBeNull());
    expect(result.current.pending?.result.summary).toBe("Fix the diff renderer");
    expect(result.current.pending?.diff?.length).toBeGreaterThan(0);

    act(() => {
      result.current.apply();
    });
    await waitFor(() => expect(result.current.pending).toBeNull());
    expect(result.current.history).toHaveLength(1);
    expect(result.current.history[0].status).toBe("applied");
    expect(result.current.history[0].description).toBe("Fix the diff renderer");
  });

  it("records a discarded entry when the user discards a pending proposal", async () => {
    const { result } = renderHook(() => mod.useRefinementGate());
    await waitFor(() => expect(result.current.autoApply).toBe(false));

    act(() => {
      mod.handleRefinementResult(refineResult("r-2", "Refactor auth"));
    });
    await waitFor(() => expect(result.current.pending).not.toBeNull());

    act(() => {
      result.current.discard();
    });
    await waitFor(() => expect(result.current.pending).toBeNull());
    expect(result.current.history).toHaveLength(1);
    expect(result.current.history[0].status).toBe("discarded");
  });

  it("records a daemon-reported error as a discarded entry without a pending proposal", async () => {
    const { result } = renderHook(() => mod.useRefinementGate());
    await waitFor(() => expect(result.current.autoApply).toBe(false));

    act(() => {
      mod.handleRefinementResult({ id: "r-3", error: "apply failed: EACCES" });
    });
    await waitFor(() => expect(result.current.history).toHaveLength(1));
    expect(result.current.pending).toBeNull();
    expect(result.current.history[0].status).toBe("discarded");
    expect(result.current.history[0].description).toContain("EACCES");
  });

  it("auto-apply skips the pending proposal and records straight to history", async () => {
    const { result } = renderHook(() => mod.useRefinementGate());
    await waitFor(() => expect(result.current.autoApply).toBe(false));

    act(() => result.current.setAutoApply(true));
    await waitFor(() => expect(result.current.autoApply).toBe(true));

    act(() => {
      mod.handleRefinementResult(refineResult("r-4", "Auto applied change"));
    });
    await waitFor(() => expect(result.current.history).toHaveLength(1));
    expect(result.current.pending).toBeNull();
    expect(result.current.history[0].status).toBe("applied");
    expect(result.current.history[0].description).toBe("Auto applied change");
  });

  it("marks a history entry as rolled back via markRolledBack", async () => {
    const { result } = renderHook(() => mod.useRefinementGate());
    await waitFor(() => expect(result.current.autoApply).toBe(false));

    act(() => {
      mod.handleRefinementResult(refineResult("r-5", "Change to roll back"));
    });
    await waitFor(() => expect(result.current.pending).not.toBeNull());
    act(() => result.current.apply());
    await waitFor(() => expect(result.current.history).toHaveLength(1));

    act(() => mod.markRolledBack("r-5"));
    await waitFor(() => expect(result.current.history[0].status).toBe("rolled-back"));
  });
});
