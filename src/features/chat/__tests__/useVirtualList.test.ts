// useVirtualList — self-contained transcript windowing hook. Stubs the DOM
// bits jsdom lacks (ResizeObserver, clientHeight, requestAnimationFrame) so the
// binary-search window, offset math, row measurement, reset, and scrollToIndex
// can be exercised against a controllable scroll container.

import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useVirtualList } from "../useVirtualList";

let roCallback: (entries: Array<{ target: HTMLElement }>) => void = () => {};
let scrollEl: HTMLDivElement;

class ResizeObserverMock {
  constructor(cb: (entries: Array<{ target: HTMLElement }>) => void) {
    roCallback = cb;
  }
  observe() {}
  unobserve() {}
  disconnect() {}
}

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", ResizeObserverMock);
  vi.stubGlobal("requestAnimationFrame", (cb: () => void) => {
    cb();
    return 1;
  });
  scrollEl = document.createElement("div");
  Object.defineProperty(scrollEl, "clientHeight", { configurable: true, get: () => 600 });
  scrollEl.scrollTop = 0;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const EST = 100;
const GAP = 10;

describe("useVirtualList", () => {
  it("mounts the full window for a small count", () => {
    const { result } = renderHook(() =>
      useVirtualList({ count: 5, estimateHeight: EST, gap: GAP, overscan: 2, scrollRef: { current: scrollEl } }),
    );
    expect(result.current.startIndex).toBe(0);
    expect(result.current.endIndex).toBe(5);
    expect(result.current.totalHeight).toBe(5 * EST + 4 * GAP);
  });

  it("returns zero total height for an empty list", () => {
    const { result } = renderHook(() =>
      useVirtualList({ count: 0, estimateHeight: EST, gap: GAP, overscan: 2, scrollRef: { current: scrollEl } }),
    );
    expect(result.current.totalHeight).toBe(0);
  });

  it("windows a large transcript based on the scroll offset", () => {
    const { result } = renderHook(() =>
      useVirtualList({ count: 100, estimateHeight: EST, gap: GAP, overscan: 2, scrollRef: { current: scrollEl } }),
    );
    expect(result.current.startIndex).toBe(0);
    expect(result.current.endIndex).toBeLessThan(100);

    scrollEl.scrollTop = 3000;
    act(() => result.current.onScroll());
    // row i top = i*110; first row at/after 3000 is 28 (3080). minus overscan 2 → 26.
    expect(result.current.startIndex).toBe(26);
    // viewport bottom at 3600; first row at/after is 33 (3630). plus overscan 2 → 35.
    expect(result.current.endIndex).toBe(35);
    // topPad = offset[26]; bottomPad = total - offset[35].
    expect(result.current.topPad).toBe(26 * 110);
  });

  it("scrollToIndex clamps and positions the scroll container", () => {
    const { result } = renderHook(() =>
      useVirtualList({ count: 100, estimateHeight: EST, gap: GAP, overscan: 2, scrollRef: { current: scrollEl } }),
    );
    act(() => result.current.scrollToIndex(50));
    // offset[50] = 5500, minus the 40px focus offset.
    expect(scrollEl.scrollTop).toBe(5500 - 40);
    // Over/under-range indexes clamp to valid bounds without throwing.
    act(() => result.current.scrollToIndex(-5));
    act(() => result.current.scrollToIndex(9999));
    expect(scrollEl.scrollTop).toBeGreaterThanOrEqual(0);
  });

  it("measureRowRef observes rendered rows and measurement bumps the total", () => {
    const { result } = renderHook(() =>
      useVirtualList({ count: 3, estimateHeight: EST, gap: GAP, overscan: 0, scrollRef: { current: scrollEl } }),
    );
    const row = document.createElement("div");
    row.dataset.index = "0";
    Object.defineProperty(row, "offsetHeight", { configurable: true, get: () => 250 });
    document.body.appendChild(row); // connected so the observer keeps it
    act(() => result.current.measureRowRef(row));
    // Fire the shared ResizeObserver callback for the measured row.
    act(() => {
      roCallback([{ target: row }]);
    });
    // totalHeight now uses the measured 250 for row 0, estimates for rows 1-2.
    expect(result.current.totalHeight).toBe(250 + 2 * EST + 2 * GAP);
  });

  it("ignores height-0 measurements", () => {
    const { result } = renderHook(() =>
      useVirtualList({ count: 2, estimateHeight: EST, gap: GAP, overscan: 0, scrollRef: { current: scrollEl } }),
    );
    const row = document.createElement("div");
    row.dataset.index = "0";
    Object.defineProperty(row, "offsetHeight", { configurable: true, get: () => 0 });
    document.body.appendChild(row);
    act(() => result.current.measureRowRef(row));
    act(() => {
      roCallback([{ target: row }]);
    });
    // Height-0 is ignored, so the total stays the estimate-based value.
    expect(result.current.totalHeight).toBe(2 * EST + GAP);
  });

  it("reset clears cached heights", () => {
    const { result } = renderHook(() =>
      useVirtualList({ count: 3, estimateHeight: EST, gap: GAP, overscan: 0, scrollRef: { current: scrollEl } }),
    );
    const row = document.createElement("div");
    row.dataset.index = "0";
    Object.defineProperty(row, "offsetHeight", { configurable: true, get: () => 250 });
    document.body.appendChild(row);
    act(() => result.current.measureRowRef(row));
    act(() => {
      roCallback([{ target: row }]);
    });
    const measured = result.current.totalHeight;
    expect(measured).not.toBe(3 * EST + 2 * GAP);

    act(() => result.current.reset());
    // After reset the estimate-based total is restored.
    expect(result.current.totalHeight).toBe(3 * EST + 2 * GAP);
  });
});
