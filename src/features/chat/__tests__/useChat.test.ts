// useChat — hook tests. We mock the IPC layer (../../ipc/client) so the hook
// runs in isolation against a controllable client and event stream. Tests run
// in the Tauri path (isTauri = true) so send() drives the mocked prompt() RPC
// deterministically instead of the timer-based browser simulation.

import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useChat } from "../useChat";

type AnyFn = (...args: never[]) => unknown;

const mockState = vi.hoisted(() => {
  const listeners: Array<(event: unknown) => void> = [];
  return {
    listeners,
    fire: (event: unknown) => {
      for (const cb of [...listeners]) cb(event);
    },
    client: {
      getTranscript: vi.fn(),
      prompt: vi.fn(),
      steer: vi.fn(),
      abort: vi.fn(),
      runCommand: vi.fn(),
      setSessionName: vi.fn(),
      getContextStats: vi.fn(),
      startSideQuestion: vi.fn(),
      retry: vi.fn(),
    } as Record<string, AnyFn>,
    conn: { queue: { mode: "busy" } },
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
    isTauri: true,
  };
});

const userMsg = (text: string) => ({ id: "u-1", role: "user", content: text, timestamp: "2026-01-01T00:00:00.000Z", status: "complete" });

function makeClient() {
  (mockState.client.getTranscript as ReturnType<typeof vi.fn>).mockResolvedValue([]);
  (mockState.client.getContextStats as ReturnType<typeof vi.fn>).mockResolvedValue({ tokens: 10 });
  for (const key of ["prompt", "steer", "abort", "runCommand", "setSessionName", "startSideQuestion", "retry"] as const) {
    (mockState.client[key] as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
  }
}

beforeEach(() => {
  mockState.listeners.length = 0;
  mockState.conn = { queue: { mode: "busy" } };
  makeClient();
});

describe("useChat", () => {
  it("returns the expected public API shape", () => {
    const { result } = renderHook(() => useChat());
    const value = result.current;
    for (const key of [
      "messages", "busy", "loaded", "error", "hasFirstMessage", "send", "steer", "abort",
      "queueFollowUp", "clearFollowUps", "popFollowUp", "followUps", "steered", "shellNotice",
      "askSideQuestion", "dismissSideQuestion", "sideQuestions", "runShell", "contextStats",
      "setSessionName", "loadDemoMessages", "editDraft", "requestEdit", "retry",
    ]) {
      expect(value).toHaveProperty(key);
    }
    expect(value.followUps).toEqual([]);
    expect(value.messages).toEqual([]);
    expect(value.busy).toBe(false);
  });

  it("loads the initial transcript and marks loaded", async () => {
    (mockState.client.getTranscript as ReturnType<typeof vi.fn>).mockResolvedValue([userMsg("hi")]);
    const { result } = renderHook(() => useChat());
    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current.messages).toHaveLength(1);
    expect(result.current.messages[0].content).toBe("hi");
    expect(result.current.hasFirstMessage).toBe(true);
  });

  it("send appends the user message, sets busy, and calls prompt; idle snapshot clears busy", async () => {
    const { result, rerender } = renderHook(() => useChat());
    await waitFor(() => expect(result.current.loaded).toBe(true));

    await act(async () => {
      await result.current.send("hello world");
    });
    expect(mockState.client.prompt).toHaveBeenCalledWith("hello world");
    expect(result.current.messages).toHaveLength(1);
    expect(result.current.messages[0].content).toBe("hello world");
    expect(result.current.busy).toBe(true);

    // The daemon reports idle → local busy reconciles to false.
    act(() => {
      mockState.conn = { queue: { mode: "idle" } };
      rerender();
    });
    await waitFor(() => expect(result.current.busy).toBe(false));
  });

  it("streams an assistant reply when a text session event arrives", async () => {
    const { result } = renderHook(() => useChat());
    await waitFor(() => expect(result.current.loaded).toBe(true));

    await act(async () => {
      await result.current.send("hi");
    });
    act(() => {
      mockState.fire({ type: "session_event", event: { kind: "text", text: "hello back" } });
    });
    expect(result.current.messages).toHaveLength(2);
    const assistant = result.current.messages[1];
    expect(assistant.role).toBe("assistant");
    expect(assistant.content).toBe("hello back");
    expect(assistant.status).toBe("streaming");
  });

  it("handles prompt failure by setting error and clearing busy", async () => {
    (mockState.client.prompt as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("daemon down"));
    const { result } = renderHook(() => useChat());
    await waitFor(() => expect(result.current.loaded).toBe(true));

    await act(async () => {
      await result.current.send("boom");
    });
    expect(result.current.error).toBe("daemon down");
    expect(result.current.busy).toBe(false);
  });

  it("abort clears streaming messages and busy", async () => {
    const { result } = renderHook(() => useChat());
    await waitFor(() => expect(result.current.loaded).toBe(true));
    await act(async () => {
      await result.current.send("hi");
    });
    // Mark the assistant message streaming so abort can finalize it.
    act(() => {
      mockState.fire({ type: "session_event", event: { kind: "text", text: "partial" } });
    });
    expect(result.current.messages.some((m) => m.status === "streaming")).toBe(true);

    await act(async () => {
      await result.current.abort();
    });
    expect(mockState.client.abort).toHaveBeenCalled();
    expect(result.current.busy).toBe(false);
    expect(result.current.messages.every((m) => m.status !== "streaming")).toBe(true);
  });

  it("manages the follow-up queue (add / pop / clear)", async () => {
    const { result } = renderHook(() => useChat());
    await waitFor(() => expect(result.current.loaded).toBe(true));

    act(() => result.current.queueFollowUp("first"));
    act(() => result.current.queueFollowUp("second"));
    expect(result.current.followUps.map((f) => f.text)).toEqual(["first", "second"]);

    let popped: string | undefined;
    act(() => {
      popped = result.current.popFollowUp();
    });
    expect(popped).toBe("second");
    expect(result.current.followUps.map((f) => f.text)).toEqual(["first"]);

    act(() => result.current.clearFollowUps());
    expect(result.current.followUps).toEqual([]);
  });

  it("steer calls the IPC steer RPC and surfaces a transient steered notice", async () => {
    const { result } = renderHook(() => useChat());
    await waitFor(() => expect(result.current.loaded).toBe(true));

    await act(async () => {
      await result.current.steer("go on");
    });
    expect(mockState.client.steer).toHaveBeenCalledWith("go on");
    expect(result.current.steered?.text).toBe("go on");
  });

  it("manages the inline side-question lifecycle", async () => {
    const { result } = renderHook(() => useChat());
    await waitFor(() => expect(result.current.loaded).toBe(true));

    act(() => result.current.askSideQuestion("side", "what is this?"));
    expect(mockState.client.startSideQuestion).toHaveBeenCalledWith("what is this?");
    expect(result.current.sideQuestions).toHaveLength(1);
    expect(result.current.sideQuestions[0].status).toBe("running");

    act(() => {
      mockState.fire({ type: "session_event", event: { kind: "side_question_event", id: result.current.sideQuestions[0].id, status: "complete" } });
    });
    expect(result.current.sideQuestions[0].status).toBe("complete");

    act(() => result.current.dismissSideQuestion(result.current.sideQuestions[0].id));
    expect(result.current.sideQuestions).toHaveLength(0);
  });
});
