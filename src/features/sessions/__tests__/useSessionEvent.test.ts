// useSessionEvent.test.ts — the sessions tree-event subscription hook. Mocks
// the IPC client event stream (following the useChat pattern) so we can drive
// session_event / non-matching events and assert the version counter only
// advances for kinds the caller cares about.

import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useSessionEvent } from "../useSessionEvent";

const mockState = vi.hoisted(() => {
  const listeners: Array<(event: unknown) => void> = [];
  return {
    listeners,
    fire: (event: unknown) => {
      for (const cb of [...listeners]) cb(event);
    },
  };
});

vi.mock("../../../ipc/client", async () => {
  const { useEffect, useRef } = await import("react");
  return {
    useIpc: () => ({}),
    // Mirror the real hook: register one stable dispatcher per mount that
    // reads the latest callback, so re-renders don't stack listeners.
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
    useConnectionState: () => ({ status: { kind: "connected" } }),
    isTauri: false,
  };
});

beforeEach(() => {
  mockState.listeners.length = 0;
});

describe("useSessionEvent", () => {
  it("starts with no event and version 0", () => {
    const { result } = renderHook(() => useSessionEvent(["tree"]));
    expect(result.current.event).toBeUndefined();
    expect(result.current.version).toBe(0);
  });

  it("ignores events that are not session_event", () => {
    const { result } = renderHook(() => useSessionEvent(["tree"]));
    act(() => mockState.fire({ type: "agent_list", agents: [] }));
    act(() => mockState.fire({ type: "connection_status", status: { kind: "connected" } }));
    expect(result.current.version).toBe(0);
    expect(result.current.event).toBeUndefined();
  });

  it("ignores session_event kinds outside the subscribed set", () => {
    const { result } = renderHook(() => useSessionEvent(["tree"]));
    act(() => mockState.fire({ type: "session_event", event: { kind: "text", text: "hi" } }));
    expect(result.current.version).toBe(0);
  });

  it("records a matching event and increments version once per event", () => {
    const { result } = renderHook(() => useSessionEvent(["tree", "context_tree"]));
    act(() => mockState.fire({ type: "session_event", event: { kind: "tree" } }));
    expect(result.current.version).toBe(1);
    expect(result.current.event).toMatchObject({ kind: "tree" });

    act(() => mockState.fire({ type: "session_event", event: { kind: "context_tree" } }));
    expect(result.current.version).toBe(2);
  });

  it("ignores session_event payloads with no event object", () => {
    const { result } = renderHook(() => useSessionEvent(["tree"]));
    act(() => mockState.fire({ type: "session_event", event: null }));
    act(() => mockState.fire({ type: "session_event", event: undefined }));
    expect(result.current.version).toBe(0);
  });

  it("honours kinds updated across renders via the ref", () => {
    const { result, rerender } = renderHook(({ kinds }) => useSessionEvent(kinds), {
      initialProps: { kinds: ["tree"] },
    });
    rerender({ kinds: ["text"] });

    act(() => mockState.fire({ type: "session_event", event: { kind: "tree" } }));
    expect(result.current.version).toBe(0);

    act(() => mockState.fire({ type: "session_event", event: { kind: "text", text: "x" } }));
    expect(result.current.version).toBe(1);
  });
});
