// useVirtualList — a self-contained windowing hook for the transcript.
//
// Renders only the slice of rows that intersect the scroll viewport (plus an
// overscan buffer) instead of mounting every message at once, so a 500+
// message transcript stays responsive. No npm dependencies.
//
// Row heights are variable (thinking blocks, tool cards, markdown), so the
// hook measures each rendered row with a SINGLE shared ResizeObserver and
// caches the height per index; unmeasured rows fall back to a fixed estimate.
// Offsets are derived from the cached heights, which keeps the scrollbar and
// the auto-stick-to-bottom behavior accurate even while a streaming message
// grows. The observer only bumps a version counter when a height actually
// changes, so it cannot loop.
//
// The caller owns the scroll container (a ref passed in) and the stick logic;
// this hook computes the visible window, exposes a stable ref callback to
// measure rows, and a stable scrollToIndex helper for programmatic focus.

import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";

export interface UseVirtualListOptions {
  /** Total number of rows. */
  count: number;
  /** Fallback height (px) for rows that have not been measured yet. */
  estimateHeight: number;
  /** Vertical gap (px) between rows — added to each row's contribution. */
  gap: number;
  /** Extra rows rendered above/below the visible window. */
  overscan: number;
  /** Ref to the scroll container element. */
  scrollRef: React.RefObject<HTMLDivElement | null>;
}

export interface VirtualListResult {
  /** First row index to render (inclusive). */
  startIndex: number;
  /** One past the last row index to render. */
  endIndex: number;
  /** Height (px) of the spacer above the rendered window. */
  topPad: number;
  /** Height (px) of the spacer below the rendered window. */
  bottomPad: number;
  /** Total estimated content height (px) — drives the scrollbar + stick. */
  totalHeight: number;
  /** Attach to the scroll container's onScroll. */
  onScroll: () => void;
  /** Stable ref callback — attach to each rendered row wrapper. */
  measureRowRef: (el: HTMLDivElement | null) => void;
  /** Drop cached heights (call when the transcript identity changes). */
  reset: () => void;
  /** Scroll a specific row index into view (for transcript search focus). */
  scrollToIndex: (index: number) => void;
}

export function useVirtualList({
  count,
  estimateHeight,
  gap,
  overscan,
  scrollRef,
}: UseVirtualListOptions): VirtualListResult {
  const [scrollTop, setScrollTop] = useState(0);
  const [viewport, setViewport] = useState(0);
  // Bumped whenever a row's measured height changes so offsets recompute.
  const [version, setVersion] = useState(0);
  const heightsRef = useRef<number[]>([]);
  const rafRef = useRef<number | null>(null);

  // Measure the viewport height synchronously before first paint (useLayoutEffect
  // avoids the top-flash + jump-to-bottom on mount), then keep it current on
  // resize via a ResizeObserver.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    setViewport(el.clientHeight);
    const ro = new ResizeObserver(() => setViewport(el.clientHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, [scrollRef]);

  // Coalesce scroll events to one state update per animation frame.
  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (rafRef.current != null) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      setScrollTop(el.scrollTop);
    });
  }, [scrollRef]);

  // Cumulative offsets: offsets[i] = top of row i. Each row contributes its
  // measured (or estimated) height plus the inter-row gap.
  const offsets = useMemo(() => {
    const arr = new Array<number>(count + 1);
    arr[0] = 0;
    for (let i = 0; i < count; i++) {
      arr[i + 1] = arr[i] + (heightsRef.current[i] ?? estimateHeight) + gap;
    }
    return arr;
  }, [count, estimateHeight, gap, version]);

  const totalHeight = count === 0 ? 0 : offsets[count] - gap;

  // Binary search for the first row whose top is at/after the scroll offset.
  let startIndex = 0;
  {
    let lo = 0;
    let hi = count;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (offsets[mid] < scrollTop) lo = mid + 1;
      else hi = mid;
    }
    startIndex = Math.max(0, lo - overscan);
  }

  // Binary search for the first row below the viewport bottom.
  let endIndex = count;
  {
    const target = scrollTop + viewport;
    let lo = 0;
    let hi = count;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (offsets[mid] < target) lo = mid + 1;
      else hi = mid;
    }
    endIndex = Math.min(count, lo + overscan);
  }

  const topPad = offsets[startIndex];
  const bottomPad = totalHeight - offsets[endIndex];

  // A single shared ResizeObserver for all rendered rows (instead of one per
  // row) so scrolling a long transcript does not churn hundreds of observers.
  // The observer reads the row index from data-index and only bumps the version
  // when a height actually changes. Detached rows stop firing, so no cleanup
  // is required on unmount.
  const sharedObserverRef = useRef<ResizeObserver | null>(null);
  const getObserver = useCallback(() => {
    if (!sharedObserverRef.current) {
      sharedObserverRef.current = new ResizeObserver((entries) => {
        for (const entry of entries) {
          const el = entry.target as HTMLDivElement;
          // Release detached rows so the observer doesn't hold every element
          // ever scrolled until the chat view unmounts.
          if (!el.isConnected) {
            sharedObserverRef.current?.unobserve(el);
            continue;
          }
          const index = Number(el.dataset.index);
          if (!Number.isFinite(index)) continue;
          const h = el.offsetHeight;
          // Ignore transient height-0 measurements (rows mid-unmount or not yet
          // laid out). Caching 0 would corrupt the offsets and shrink the
          // scrollbar / break auto-stick after scrolling away and back.
          if (h <= 0) continue;
          if (heightsRef.current[index] !== h) {
            heightsRef.current[index] = h;
            setVersion((v) => v + 1);
          }
        }
      });
    }
    return sharedObserverRef.current;
  }, []);

  // Stable ref callback: observes each rendered row with the shared observer.
  const measureRowRef = useCallback(
    (el: HTMLDivElement | null) => {
      if (!el) return;
      getObserver().observe(el);
    },
    [getObserver],
  );

  const reset = useCallback(() => {
    heightsRef.current = [];
    setVersion((v) => v + 1);
  }, []);

  // Keep the latest offsets/count in refs so scrollToIndex is STABLE (it must
  // not be recreated on every height-measurement version bump — that would
  // re-arm the caller's focus effect on every scroll/stream).
  const offsetsRef = useRef(offsets);
  offsetsRef.current = offsets;
  const countRef = useRef(count);
  countRef.current = count;

  const scrollToIndex = useCallback(
    (index: number) => {
      const el = scrollRef.current;
      if (!el) return;
      const clamped = Math.max(0, Math.min(countRef.current - 1, index));
      const target = offsetsRef.current[clamped];
      el.scrollTop = Math.max(0, target - 40);
    },
    [scrollRef],
  );

  return { startIndex, endIndex, topPad, bottomPad, totalHeight, onScroll, measureRowRef, reset, scrollToIndex };
}
