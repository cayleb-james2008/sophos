// useAgents — hook tests. Mocks the IPC layer so the agent command center runs
// against a controllable client and event stream.

import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAgents } from "../useAgents";

type AnyFn = (...args: never[]) => unknown;

const mockState = vi.hoisted(() => {
  const listeners: Array<(event: unknown) => void> = [];
  return {
    listeners,
    fire: (event: unknown) => {
      for (const cb of [...listeners]) cb(event);
    },
    client: {
      listAgents: vi.fn(),
      getRlmChildren: vi.fn(),
      listInbox: vi.fn(),
      attachAgent: vi.fn(),
      detachAgent: vi.fn(),
      getAgentState: vi.fn(),
      sendAgentMessage: vi.fn(),
      markMessageRead: vi.fn(),
    } as Record<string, AnyFn>,
    conn: { status: { kind: "connected" }, model: { provider: "p", model: "m" } },
  };
});

vi.mock("../../../ipc/client", async () => {
  const { useEffect, useRef } = await import("react");
  return {
    useIpc: () => mockState.client,
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
    useConnectionState: () => mockState.conn,
  };
});

vi.mock("../../../ipc/unread", () => ({
  useUnreadRefresh: () => () => undefined,
}));

function makeClient() {
  (mockState.client.listAgents as ReturnType<typeof vi.fn>).mockResolvedValue([
    { id: "a-1", name: "Worker", status: "running", sessionId: "s-1" },
  ]);
  (mockState.client.getRlmChildren as ReturnType<typeof vi.fn>).mockResolvedValue([
    { id: "r-1", name: "critic", status: "done", parentId: "s-1", sessionId: "s-2", summary: "reviewed" },
  ]);
  (mockState.client.listInbox as ReturnType<typeof vi.fn>).mockResolvedValue([
    { id: "m-1", fromAgentId: "a-1", fromAgentName: "Worker", toAgentId: "self", text: "hello", timestamp: "2026-01-01T00:00:00.000Z", read: false },
  ]);
  (mockState.client.attachAgent as ReturnType<typeof vi.fn>).mockResolvedValue({ childId: "a-1", sessionId: "s-1", attached: true });
  (mockState.client.detachAgent as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
  (mockState.client.getAgentState as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "a-1", status: "running", transcript: [] });
  (mockState.client.sendAgentMessage as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "rec-1", target: { activeSessionId: "s-1", sessionId: "s-1" }, message: "hi", deliveryStatus: "delivered" });
  (mockState.client.markMessageRead as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
}

beforeEach(() => {
  mockState.listeners.length = 0;
  makeClient();
});

describe("useAgents", () => {
  it("loads agents + RLM children + inbox and auto-selects the first row", async () => {
    const { result } = renderHook(() => useAgents());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.rows).toHaveLength(2);
    expect(result.current.rows[0].id).toBe("a-1");
    expect(result.current.rows[1].kind).toBe("rlm");
    expect(result.current.selectedId).toBe("a-1");
    expect(result.current.totalUnread).toBe(1);
  });

  it("handles agent_list events by replacing the daemon agent slice", async () => {
    const { result } = renderHook(() => useAgents());
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => {
      mockState.fire({ type: "agent_list", agents: [{ id: "a-2", name: "New", status: "idle", sessionId: "s-3" }] });
    });
    expect(result.current.rows.filter((r) => r.kind === "daemon").map((r) => r.id)).toEqual(["a-2"]);
  });

  it("attach selects the agent; attach failure surfaces an error", async () => {
    const { result } = renderHook(() => useAgents());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.attach("a-1");
    });
    expect(mockState.client.attachAgent).toHaveBeenCalledWith("a-1");
    expect(result.current.selectedId).toBe("a-1");

    (mockState.client.attachAgent as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("attach failed"));
    await act(async () => {
      await result.current.attach("a-1");
    });
    expect(result.current.error).toBe("attach failed");
  });

  it("send delivers a message and echoes it optimistically into the inbox", async () => {
    const { result } = renderHook(() => useAgents());
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => result.current.setDraft("go"));
    await act(async () => {
      await result.current.send();
    });
    expect(mockState.client.sendAgentMessage).toHaveBeenCalledWith("a-1", "go");
    expect(result.current.deliveryReceipt?.deliveryStatus).toBe("delivered");
    const echo = result.current.inbox.find((m) => m.id === "local-rec-1");
    expect(echo?.text).toBe("go");
  });

  it("send failure surfaces an error and does not clear the draft", async () => {
    (mockState.client.sendAgentMessage as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("relay down"));
    const { result } = renderHook(() => useAgents());
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => result.current.setDraft("hello"));
    await act(async () => {
      await result.current.send();
    });
    expect(result.current.error).toBe("relay down");
  });

  it("markRead flags the message as read locally", async () => {
    const { result } = renderHook(() => useAgents());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.totalUnread).toBe(1);
    await act(async () => {
      await result.current.markRead("m-1");
    });
    expect(mockState.client.markMessageRead).toHaveBeenCalledWith("m-1");
    expect(result.current.inbox.find((m) => m.id === "m-1")?.read).toBe(true);
    expect(result.current.totalUnread).toBe(0);
  });
});
