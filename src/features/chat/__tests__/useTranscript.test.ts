// useTranscript — transcript slice: load, edit/resend, retry, streaming events.
// Runs in the Tauri path (isTauri = true) so send/edit/retry drive the mocked
// IPC RPCs directly and the transcript is advanced by the event stream.

import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useTranscript } from "../useTranscript";
import type { TranscriptMessage } from "../../../ipc/contract";

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
      retry: vi.fn(),
    } as Record<string, AnyFn>,
  };
});

vi.mock("../../../ipc/client", async () => {
  const { useEffect, useRef } = await import("react");
  return {
    useIpc: () => mockState.client,
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
    useConnectionState: () => ({}),
    isTauri: true,
  };
});

const userMsg = (text: string): TranscriptMessage => ({
  id: `u-${text}`,
  role: "user",
  content: text,
  timestamp: "2026-01-01T00:00:00.000Z",
  status: "complete",
});
const asstMsg = (text: string): TranscriptMessage => ({
  id: `a-${text}`,
  role: "assistant",
  content: text,
  timestamp: "2026-01-01T00:00:00.000Z",
  status: "complete",
});

function setup() {
  const setBusy = vi.fn();
  const setError = vi.fn();
  const busyRef = { current: false };
  const hook = renderHook(() => useTranscript({ setBusy, setError, busyRef }));
  return { hook, setBusy, setError, busyRef };
}

beforeEach(() => {
  mockState.listeners.length = 0;
  vi.clearAllMocks();
  (mockState.client.getTranscript as ReturnType<typeof vi.fn>).mockResolvedValue([]);
  (mockState.client.prompt as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
  (mockState.client.retry as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
});

describe("useTranscript", () => {
  it("loads the initial transcript and marks loaded", async () => {
    (mockState.client.getTranscript as ReturnType<typeof vi.fn>).mockResolvedValue([userMsg("hi")]);
    const { hook } = setup();
    await waitFor(() => expect(hook.result.current.loaded).toBe(true));
    expect(hook.result.current.messages).toHaveLength(1);
    expect(hook.result.current.messages[0].content).toBe("hi");
  });

  it("marks loaded even when the transcript load fails", async () => {
    (mockState.client.getTranscript as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("down"));
    const { hook } = setup();
    await waitFor(() => expect(hook.result.current.loaded).toBe(true));
    expect(hook.result.current.messages).toEqual([]);
  });

  it("runTurn appends a user message, sets busy, and calls prompt", async () => {
    const { hook, setBusy } = setup();
    await waitFor(() => expect(hook.result.current.loaded).toBe(true));
    await act(async () => {
      await hook.result.current.runTurn("  hello  ");
    });
    expect(mockState.client.prompt).toHaveBeenCalledWith("hello");
    expect(hook.result.current.messages).toHaveLength(1);
    expect(hook.result.current.messages[0].role).toBe("user");
    expect(hook.result.current.messages[0].content).toBe("hello");
    expect(setBusy).toHaveBeenLastCalledWith(true);
  });

  it("runTurn ignores empty text", async () => {
    const { hook } = setup();
    await waitFor(() => expect(hook.result.current.loaded).toBe(true));
    await act(async () => {
      await hook.result.current.runTurn("   ");
    });
    expect(mockState.client.prompt).not.toHaveBeenCalled();
    expect(hook.result.current.messages).toEqual([]);
  });

  it("runTurn surfaces a prompt failure via setError and clears busy", async () => {
    (mockState.client.prompt as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("daemon down"));
    const { hook, setBusy, setError } = setup();
    await waitFor(() => expect(hook.result.current.loaded).toBe(true));
    await act(async () => {
      await hook.result.current.runTurn("boom");
    });
    expect(setError).toHaveBeenCalledWith("daemon down");
    expect(setBusy).toHaveBeenLastCalledWith(false);
  });

  it("editAndResend replaces the message slice and re-prompts", async () => {
    (mockState.client.getTranscript as ReturnType<typeof vi.fn>).mockResolvedValue([userMsg("A"), asstMsg("B")]);
    const { hook } = setup();
    await waitFor(() => expect(hook.result.current.loaded).toBe(true));
    await act(async () => {
      await hook.result.current.editAndResend(1, "  edited  ");
    });
    expect(mockState.client.prompt).toHaveBeenCalledWith("edited");
    expect(hook.result.current.messages.map((m) => m.content)).toEqual(["A", "edited"]);
  });

  it("retry re-issues the preceding user prompt", async () => {
    (mockState.client.getTranscript as ReturnType<typeof vi.fn>).mockResolvedValue([userMsg("A"), asstMsg("B")]);
    const { hook } = setup();
    await waitFor(() => expect(hook.result.current.loaded).toBe(true));
    const b = hook.result.current.messages[1];
    act(() => {
      hook.result.current.retry(b);
    });
    await waitFor(() => expect(mockState.client.retry).toHaveBeenCalled());
  });

  it("retry does nothing when there is no preceding user message", async () => {
    const { hook } = setup();
    await waitFor(() => expect(hook.result.current.loaded).toBe(true));
    act(() => {
      hook.result.current.retry(userMsg("A"));
    });
    expect(mockState.client.retry).not.toHaveBeenCalled();
  });

  it("streams assistant text via the text event", async () => {
    const { hook } = setup();
    await waitFor(() => expect(hook.result.current.loaded).toBe(true));
    act(() => {
      mockState.fire({ type: "session_event", event: { kind: "text", text: "hello back" } });
    });
    expect(hook.result.current.messages).toHaveLength(1);
    expect(hook.result.current.messages[0].role).toBe("assistant");
    expect(hook.result.current.messages[0].content).toBe("hello back");
    expect(hook.result.current.messages[0].status).toBe("streaming");
  });

  it("streams thinking into the assistant message", async () => {
    const { hook } = setup();
    await waitFor(() => expect(hook.result.current.loaded).toBe(true));
    act(() => {
      mockState.fire({ type: "session_event", event: { kind: "text", text: "x" } });
    });
    act(() => {
      mockState.fire({ type: "session_event", event: { kind: "thinking", thinking: "hmm" } });
    });
    expect(hook.result.current.messages[0].thinking).toContain("hmm");
  });

  it("appends a running tool call and completes it via tool_result", async () => {
    const { hook } = setup();
    await waitFor(() => expect(hook.result.current.loaded).toBe(true));
    // Create the assistant message first (text events with empty text are skipped).
    act(() => {
      mockState.fire({ type: "session_event", event: { kind: "text", text: "start" } });
    });
    expect(hook.result.current.messages).toHaveLength(1);
    act(() => {
      mockState.fire({ type: "session_event", event: { kind: "tool_call", name: "read_file", input: "{\"p\":1}" } });
    });
    const tc = hook.result.current.messages[0].toolCalls![0];
    expect(tc.name).toBe("read_file");
    expect(tc.status).toBe("running");

    act(() => {
      mockState.fire({ type: "session_event", event: { kind: "tool_result", name: "read_file", output: "42 lines" } });
    });
    expect(hook.result.current.messages[0].toolCalls![0].status).toBe("complete");
    expect(hook.result.current.messages[0].toolCalls![0].output).toBe("42 lines");
  });

  it("handles message_delta content blocks (text/thinking/toolCall)", async () => {
    const { hook } = setup();
    await waitFor(() => expect(hook.result.current.loaded).toBe(true));
    act(() => {
      mockState.fire({
        type: "session_event",
        event: {
          kind: "message_delta",
          content: [
            { type: "text", text: "result" },
            { type: "thinking", thinking: "reasoned" },
            { type: "toolCall", name: "write_file", id: "tc-1", arguments: { path: "x" } },
          ],
        },
      });
    });
    expect(hook.result.current.messages).toHaveLength(1);
    expect(hook.result.current.messages[0].content).toBe("result");
    expect(hook.result.current.messages[0].thinking).toBe("reasoned");
    expect(hook.result.current.messages[0].toolCalls).toHaveLength(1);
    expect(hook.result.current.messages[0].toolCalls![0].name).toBe("write_file");
  });

  it("handles the error event by clearing busy and setting error", async () => {
    const { hook, setBusy, setError } = setup();
    await waitFor(() => expect(hook.result.current.loaded).toBe(true));
    act(() => {
      mockState.fire({ type: "session_event", event: { kind: "text", text: "partial" } });
    });
    act(() => {
      mockState.fire({ type: "session_event", event: { kind: "error", message: "oops" } });
    });
    expect(setError).toHaveBeenCalledWith("oops");
    expect(setBusy).toHaveBeenCalledWith(false);
  });

  it("appends a user message and sets busy on the user_message event", async () => {
    const { hook, setBusy } = setup();
    await waitFor(() => expect(hook.result.current.loaded).toBe(true));
    act(() => {
      mockState.fire({ type: "session_event", event: { kind: "user_message", text: "typed" } });
    });
    expect(hook.result.current.messages[0].content).toBe("typed");
    expect(hook.result.current.messages[0].role).toBe("user");
    expect(setBusy).toHaveBeenCalledWith(true);
  });

  it("requestEdit records the edit draft", async () => {
    const { hook } = setup();
    await waitFor(() => expect(hook.result.current.loaded).toBe(true));
    act(() => {
      hook.result.current.requestEdit(3, "draft text");
    });
    expect(hook.result.current.editDraft).toEqual({ index: 3, text: "draft text" });
  });
});
