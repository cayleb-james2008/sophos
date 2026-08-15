// useSideQuestions — inline side-question panel state. Runs in the Tauri path
// (isTauri = true) so askSideQuestion only fires the IPC RPC and the panel is
// updated by the side_question_event stream rather than the browser simulation.

import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useSideQuestions } from "../useSideQuestions";

const mockState = vi.hoisted(() => {
  const listeners: Array<(event: unknown) => void> = [];
  return {
    listeners,
    fire: (event: unknown) => {
      for (const cb of [...listeners]) cb(event);
    },
    client: {
      startSideQuestion: vi.fn().mockResolvedValue({ id: "side-1" }),
    } as Record<string, (...args: never[]) => unknown>,
  };
});

vi.mock("../../../ipc/client", () => ({
  useIpc: () => mockState.client,
  useIpcEvent: (cb: (event: unknown) => void) => {
    mockState.listeners.push(cb);
    return () => {
      const i = mockState.listeners.indexOf(cb);
      if (i >= 0) mockState.listeners.splice(i, 1);
    };
  },
  useConnectionState: () => ({}),
  isTauri: true,
}));

beforeEach(() => {
  mockState.listeners.length = 0;
  vi.clearAllMocks();
});

describe("useSideQuestions", () => {
  it("starts with an empty panel", () => {
    const { result } = renderHook(() => useSideQuestions());
    expect(result.current.sideQuestions).toEqual([]);
  });

  it("asks a side question, adds it running, and fires the IPC RPC", () => {
    const { result } = renderHook(() => useSideQuestions());
    act(() => result.current.askSideQuestion("side", "what is this?"));
    expect(mockState.client.startSideQuestion).toHaveBeenCalledWith("what is this?");
    expect(result.current.sideQuestions).toHaveLength(1);
    expect(result.current.sideQuestions[0].kind).toBe("side");
    expect(result.current.sideQuestions[0].status).toBe("running");
    expect(result.current.sideQuestions[0].answer).toBe("");
  });

  it("trims the question and ignores empty input", () => {
    const { result } = renderHook(() => useSideQuestions());
    act(() => result.current.askSideQuestion("btw", "   "));
    expect(result.current.sideQuestions).toEqual([]);
    expect(mockState.client.startSideQuestion).not.toHaveBeenCalled();
  });

  it("updates status from the side_question_event stream", () => {
    const { result } = renderHook(() => useSideQuestions());
    act(() => result.current.askSideQuestion("side", "question"));
    const id = result.current.sideQuestions[0].id;

    act(() => {
      mockState.fire({ type: "session_event", event: { kind: "side_question_event", id, status: "complete" } });
    });
    expect(result.current.sideQuestions[0].status).toBe("complete");
  });

  it("normalizes unknown statuses to running", () => {
    const { result } = renderHook(() => useSideQuestions());
    act(() => result.current.askSideQuestion("side", "q"));
    const id = result.current.sideQuestions[0].id;
    act(() => {
      mockState.fire({ type: "session_event", event: { kind: "side_question_event", id, status: "weird" } });
    });
    expect(result.current.sideQuestions[0].status).toBe("running");
  });

  it("dismisses a side question by id", () => {
    const { result } = renderHook(() => useSideQuestions());
    act(() => result.current.askSideQuestion("side", "q"));
    const id = result.current.sideQuestions[0].id;
    act(() => result.current.dismissSideQuestion(id));
    expect(result.current.sideQuestions).toEqual([]);
  });

  it("ignores events for unknown ids and unrelated event kinds", () => {
    const { result } = renderHook(() => useSideQuestions());
    act(() => result.current.askSideQuestion("side", "q"));
    act(() => {
      mockState.fire({ type: "session_event", event: { kind: "side_question_event", id: "nope", status: "complete" } });
      mockState.fire({ type: "session_event", event: { kind: "text", text: "hi" } });
      mockState.fire({ type: "connection_status" });
    });
    expect(result.current.sideQuestions).toHaveLength(1);
    expect(result.current.sideQuestions[0].status).toBe("running");
  });
});
