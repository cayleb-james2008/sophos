// useRunGuard — client-side reliability guardrails for long-running work.
// Mocks ipc/client: useConnectionState drives the connection snapshot, and
// useIpcEvent captures the event dispatcher so iteration counting can be
// driven deterministically.

import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useRunGuard, DEFAULT_MAX_COST, DEFAULT_MAX_TOKENS, DEFAULT_MAX_ITERATIONS } from "../useRunGuard";

const mockState = vi.hoisted(() => {
  const listeners: Array<(event: unknown) => void> = [];
  return {
    listeners,
    fire: (event: unknown) => {
      for (const cb of [...listeners]) cb(event);
    },
    conn: {
      status: { kind: "connected" },
      goals: [],
      autonomousConfig: undefined,
      costStats: undefined,
      context: undefined,
    } as Record<string, unknown>,
  };
});

vi.mock("../../../ipc/client", async () => {
  const { useEffect, useRef } = await import("react");
  return {
    useConnectionState: () => mockState.conn,
    useIpcEvent: (cb: (event: unknown) => void) => {
      const cbRef = useRef(cb);
      cbRef.current = cb;
      useEffect(() => {
        const l = (event: unknown) => cbRef.current(event);
        mockState.listeners.push(l);
        return () => {
          const i = mockState.listeners.indexOf(l);
          if (i >= 0) mockState.listeners.splice(i, 1);
        };
      }, []);
    },
  };
});

function baseConn() {
  return {
    status: { kind: "connected" },
    goals: [],
    autonomousConfig: undefined,
    costStats: undefined,
    context: undefined,
  };
}

beforeEach(() => {
  mockState.listeners.length = 0;
  mockState.conn = baseConn();
});

describe("useRunGuard", () => {
  it("starts inactive with no budget trip and no reason", () => {
    const { result } = renderHook(() => useRunGuard());
    expect(result.current.active).toBe(false);
    expect(result.current.engineDown).toBe(false);
    expect(result.current.budgetTripped).toBe(false);
    expect(result.current.reason).toBeNull();
    expect(result.current.cost).toBe(0);
    expect(result.current.tokens).toBe(0);
    expect(result.current.iterations).toBe(0);
  });

  it("flags engineDown when disconnected while a goal is active", () => {
    mockState.conn = { ...baseConn(), status: { kind: "disconnected" }, goals: [{ id: "g1", objective: "x", status: "active" }] };
    const { result } = renderHook(() => useRunGuard());
    expect(result.current.engineDown).toBe(true);
    expect(result.current.active).toBe(true);
    expect(result.current.goalActive).toBe(true);
  });

  it("does not flag engineDown when disconnected with nothing active", () => {
    mockState.conn = { ...baseConn(), status: { kind: "reconnecting" } };
    const { result } = renderHook(() => useRunGuard());
    expect(result.current.engineDown).toBe(true);
    expect(result.current.active).toBe(false);
    expect(result.current.budgetTripped).toBe(false);
  });

  it("derives autoActive from autonomousConfig.active", () => {
    mockState.conn = { ...baseConn(), autonomousConfig: { active: true } };
    const { result } = renderHook(() => useRunGuard());
    expect(result.current.autoActive).toBe(true);
    expect(result.current.active).toBe(true);
  });

  it("trips the spend breaker when cost reaches the default cap and a loop is active", () => {
    mockState.conn = {
      ...baseConn(),
      autonomousConfig: { active: true },
      costStats: { totalCost: DEFAULT_MAX_COST },
    };
    const { result } = renderHook(() => useRunGuard());
    expect(result.current.cost).toBe(DEFAULT_MAX_COST);
    expect(result.current.budgetTripped).toBe(true);
    expect(result.current.reason).toContain(`$${DEFAULT_MAX_COST.toFixed(2)}`);
  });

  it("does not trip the spend breaker when cost is high but nothing is active", () => {
    mockState.conn = { ...baseConn(), costStats: { totalCost: 999 } };
    const { result } = renderHook(() => useRunGuard());
    expect(result.current.budgetTripped).toBe(false);
  });

  it("trips the token breaker when context tokens reach the cap", () => {
    mockState.conn = {
      ...baseConn(),
      goals: [{ id: "g", objective: "x", status: "active" }],
      context: { tokens: DEFAULT_MAX_TOKENS },
    };
    const { result } = renderHook(() => useRunGuard());
    expect(result.current.tokens).toBe(DEFAULT_MAX_TOKENS);
    expect(result.current.budgetTripped).toBe(true);
    expect(result.current.reason).toContain("tokens");
  });

  it("honors a daemon-reported autonomous maxTokens over the client default", () => {
    mockState.conn = {
      ...baseConn(),
      autonomousConfig: { active: true, maxTokens: 100 },
      context: { tokens: 100 },
    };
    const { result } = renderHook(() => useRunGuard());
    expect(result.current.maxTokens).toBe(100);
    expect(result.current.budgetTripped).toBe(true);
  });

  it("counts assistant message events as iterations and trips the iteration breaker", async () => {
    mockState.conn = { ...baseConn(), autonomousConfig: { active: true, maxTurns: 2 } };
    const { result } = renderHook(() => useRunGuard());

    act(() => {
      mockState.fire({ type: "session_event", event: { kind: "message", message: { id: "m1" } } });
      mockState.fire({ type: "session_event", event: { kind: "message", message: { id: "m2" } } });
    });
    await waitFor(() => expect(result.current.iterations).toBe(2));
    expect(result.current.budgetTripped).toBe(true);
    expect(result.current.reason).toContain("iterations 2");
  });

  it("ignores non-message events when counting iterations", async () => {
    mockState.conn = { ...baseConn(), autonomousConfig: { active: true, maxTurns: 5 } };
    const { result } = renderHook(() => useRunGuard());
    act(() => {
      mockState.fire({ type: "session_event", event: { kind: "text", text: "hi" } });
    });
    await waitFor(() => expect(result.current.iterations).toBe(0));
    expect(result.current.budgetTripped).toBe(false);
  });

  it("derives tokens from costStats input+output when context is absent", () => {
    mockState.conn = {
      ...baseConn(),
      goals: [{ id: "g", objective: "x", status: "active" }],
      costStats: { inputTokens: 150, outputTokens: 60 },
    };
    const { result } = renderHook(() => useRunGuard());
    expect(result.current.tokens).toBe(210);
  });

  it("exposes the default caps", () => {
    expect(DEFAULT_MAX_COST).toBe(50);
    expect(DEFAULT_MAX_TOKENS).toBe(200000);
    expect(DEFAULT_MAX_ITERATIONS).toBe(20);
  });
});
