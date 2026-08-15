// usePromptQueue — steering/follow-up queue plus transient steer & shell
// notices. Tests cover the queue semantics (trim, dedupe-free append, pop,
// clear), the timed notices, and the busy→idle drain loop that re-dispatches
// queued follow-ups one at a time via sendRef.

import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MutableRefObject } from "react";
import { usePromptQueue } from "../usePromptQueue";

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

function setup(busy: boolean, busyRefVal = busy, sendImpl?: () => Promise<void>) {
  const busyRef = { current: busyRefVal } as MutableRefObject<boolean>;
  const sendRef = { current: sendImpl ?? vi.fn().mockResolvedValue(undefined) } as MutableRefObject<
    (text: string) => Promise<void>
  >;
  const hook = renderHook(({ busy: b }) => usePromptQueue({ busy: b, busyRef, sendRef }), {
    initialProps: { busy },
  });
  return { ...hook, busyRef, sendRef };
}

describe("usePromptQueue", () => {
  it("starts empty with no notices", () => {
    const { result } = setup(false);
    expect(result.current.followUps).toEqual([]);
    expect(result.current.steered).toBeNull();
    expect(result.current.shellNotice).toBeNull();
  });

  it("queues follow-ups with trimming and monotonically increasing ids", () => {
    const { result } = setup(false);
    act(() => result.current.queueFollowUp("  first  "));
    act(() => result.current.queueFollowUp("second"));
    expect(result.current.followUps).toEqual([
      { id: 1, text: "first" },
      { id: 2, text: "second" },
    ]);
  });

  it("ignores empty or whitespace-only follow-ups", () => {
    const { result } = setup(false);
    act(() => result.current.queueFollowUp("   "));
    act(() => result.current.queueFollowUp(""));
    expect(result.current.followUps).toEqual([]);
  });

  it("pops the most recently queued follow-up back into the editor", () => {
    const { result } = setup(false);
    act(() => result.current.queueFollowUp("a"));
    act(() => result.current.queueFollowUp("b"));
    let popped: string | undefined;
    act(() => {
      popped = result.current.popFollowUp();
    });
    expect(popped).toBe("b");
    expect(result.current.followUps.map((f) => f.text)).toEqual(["a"]);
  });

  it("returns undefined when popping an empty queue", () => {
    const { result } = setup(false);
    let popped: string | undefined = "sentinel";
    act(() => {
      popped = result.current.popFollowUp();
    });
    expect(popped).toBeUndefined();
    expect(result.current.followUps).toEqual([]);
  });

  it("clears the whole queue", () => {
    const { result } = setup(false);
    act(() => result.current.queueFollowUp("a"));
    act(() => result.current.queueFollowUp("b"));
    act(() => result.current.clearFollowUps());
    expect(result.current.followUps).toEqual([]);
  });

  it("shows a transient steered notice that auto-clears", () => {
    const { result } = setup(false);
    act(() => result.current.showSteered("go on"));
    expect(result.current.steered?.text).toBe("go on");
    act(() => {
      vi.advanceTimersByTime(4000);
    });
    expect(result.current.steered).toBeNull();
  });

  it("ignores empty steered text", () => {
    const { result } = setup(false);
    act(() => result.current.showSteered("   "));
    expect(result.current.steered).toBeNull();
  });

  it("shows a shell notice and marks it hidden when requested", () => {
    const { result } = setup(false);
    act(() => result.current.showShellNotice("ls -la", true));
    expect(result.current.shellNotice).toEqual({ command: "ls -la", hidden: true });
    act(() => {
      vi.advanceTimersByTime(4000);
    });
    expect(result.current.shellNotice).toBeNull();
  });

  it("drains queued follow-ups one at a time after busy clears", async () => {
    const sendMock = vi.fn().mockResolvedValue(undefined);
    const { result, rerender, sendRef } = setup(true, true, sendMock);
    sendRef.current = sendMock;

    act(() => result.current.queueFollowUp("first"));
    act(() => result.current.queueFollowUp("second"));
    expect(result.current.followUps).toHaveLength(2);

    // Busy → idle triggers the drain.
    await act(async () => {
      rerender({ busy: false });
    });

    expect(sendMock).toHaveBeenCalledTimes(2);
    expect(sendMock.mock.calls.map((c) => c[0])).toEqual(["first", "second"]);
    expect(result.current.followUps).toEqual([]);
  });

  it("does not drain while still busy", async () => {
    const sendMock = vi.fn().mockResolvedValue(undefined);
    const { result, rerender, sendRef } = setup(true, true, sendMock);
    sendRef.current = sendMock;
    act(() => result.current.queueFollowUp("stays"));

    // Re-render still busy → no flush.
    await act(async () => {
      rerender({ busy: true });
    });
    expect(sendMock).not.toHaveBeenCalled();
    expect(result.current.followUps).toHaveLength(1);
  });
});
