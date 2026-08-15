// useStall — "no progress for N minutes" detector. Uses fake timers to drive
// the 1s polling interval deterministically and assert the stalled flag toggles
// only once the quiet window is exceeded.

import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useStall } from "../useStall";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

const advance = (ms: number) => act(() => {
  vi.advanceTimersByTime(ms);
});

describe("useStall", () => {
  it("never flags stalled while inactive", () => {
    const { result } = renderHook(() => useStall(false, "sig", 3000));
    advance(10_000);
    expect(result.current).toBe(false);
  });

  it("flags stalled once the quiet window is exceeded while active", () => {
    const { result } = renderHook(() => useStall(true, "sig", 3000));
    expect(result.current).toBe(false);
    // Under the threshold (strictly greater than) — still not stalled.
    advance(3000);
    expect(result.current).toBe(false);
    // Over the threshold.
    advance(1000);
    expect(result.current).toBe(true);
  });

  it("resets the clock and clears stalled when the activity signal changes", () => {
    const { result, rerender } = renderHook(({ sig }) => useStall(true, sig, 3000), {
      initialProps: { sig: "a" },
    });
    advance(5000);
    expect(result.current).toBe(true);

    // Changing the signal restarts the clock and clears the stall.
    rerender({ sig: "b" });
    expect(result.current).toBe(false);
    advance(3000);
    expect(result.current).toBe(false);
    advance(1000);
    expect(result.current).toBe(true);
  });

  it("treats a serialized-identical signal as unchanged (no reset)", () => {
    // Two distinct object references that stringify the same must not reset.
    const { result, rerender } = renderHook(({ sig }) => useStall(true, sig, 2000), {
      initialProps: { sig: JSON.stringify({ a: 1 }) },
    });
    advance(3000);
    expect(result.current).toBe(true);
    rerender({ sig: JSON.stringify({ a: 1 }) });
    expect(result.current).toBe(true);
  });

  it("clears the stall when the item becomes inactive", () => {
    const { result, rerender } = renderHook(({ active }) => useStall(active, "sig", 2000), {
      initialProps: { active: true },
    });
    advance(3000);
    expect(result.current).toBe(true);

    rerender({ active: false });
    expect(result.current).toBe(false);
  });
});
