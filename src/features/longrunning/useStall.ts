// useStall — "no progress for N minutes" detector for long-running work (A2).
//
// Research D28 / D29: goal mode loops forever (#986) and programmatic prompts
// starve at idle (#1000) — the session can sit with no actionable progress for
// hours. This hook flags when an active item has not changed its activity
// signal for `thresholdMs`. The signal is a serialized value (e.g. the goals
// list or the context/queue state); when it stops changing while the item is
// active, the item is considered stalled.
//
// Honest label: this is a client-side heuristic derived from what the daemon
// reports (progress strings, context tokens, queue mode). It does not claim to
// know the kernel is dead — it reports "no activity reported for N min".

import { useEffect, useRef, useState } from "react";

export function useStall(active: boolean, activitySignal: unknown, thresholdMs: number): boolean {
  const lastChange = useRef(Date.now());
  const prev = useRef(activitySignal);
  const [stalled, setStalled] = useState(false);

  // Reset the clock whenever the activity signal changes.
  useEffect(() => {
    if (prev.current !== activitySignal) {
      prev.current = activitySignal;
      lastChange.current = Date.now();
      setStalled(false);
    }
  }, [activitySignal]);

  // Poll once a second; flag stalled once the quiet window is exceeded.
  useEffect(() => {
    if (!active) {
      setStalled(false);
      return;
    }
    const id = window.setInterval(() => {
      setStalled(Date.now() - lastChange.current > thresholdMs);
    }, 1000);
    return () => window.clearInterval(id);
  }, [active, thresholdMs]);

  return stalled;
}
