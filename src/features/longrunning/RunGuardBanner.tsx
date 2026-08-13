// RunGuardBanner — always-visible reliability guardrails for long-running work
// (A2, incl. D36b). Mounted in the Shell. Surfaces two conditions prominently
// instead of letting a goal/autonomous loop hang silently:
//
//   (e1) Engine down while a loop is active — "Engine is down — the loop can't
//        continue." Honest label: reflects the connection status the daemon
//        reports (the contract exposes no separate kernel-liveness signal).
//   (e2) Spend/iteration budget reached — a client-side circuit-breaker that
//        trips when cost/tokens/iterations exceed the cap while a loop is
//        active, with one-click Pause/Stop recovery and a "resume?" override.

import { useRef, useState } from "react";
import { Text, Button } from "../../design";
import { useIpc } from "../../ipc/client";
import { useRunGuard } from "./useRunGuard";
import "./longrunning.css";

const GRACE_MS = 60_000;

export function RunGuardBanner() {
  const ipc = useIpc();
  const guard = useRunGuard();
  const [paused, setPaused] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const graceUntil = useRef(0);
  const inGrace = Date.now() < graceUntil.current;

  const showBudget = guard.budgetTripped && !inGrace && !dismissed;

  // (e1) Engine down while a loop is active.
  if (guard.engineDown && guard.active) {
    return (
      <div role="alert" className="lr-guard lr-guard--danger">
        <span className="lr-guard__dot lr-guard__dot--danger" aria-hidden />
        <div className="lr-guard__main">
          <Text variant="label" weight="semibold" tone="danger">
            Engine is down — the {guard.goalActive ? "goal" : "autonomous"} loop can't continue
          </Text>
          <Text variant="micro" tone="muted">
            The daemon reports the engine disconnected while a loop is active. Check the engine terminal and
            daemon status. This reflects the connection status the daemon reports.
          </Text>
        </div>
        <Button variant="outline" size="sm" onClick={() => setDismissed(true)}>
          Dismiss
        </Button>
      </div>
    );
  }

  // (e2) Budget reached — paused. Resume?
  if (paused && guard.budgetTripped) {
    return (
      <div role="alert" className="lr-guard lr-guard--warn">
        <span className="lr-guard__dot lr-guard__dot--warn" aria-hidden />
        <div className="lr-guard__main">
          <Text variant="label" weight="semibold" tone="warning">
            Run budget reached — paused
          </Text>
          <Text variant="micro" tone="muted">
            {guard.reason}. The loop is paused. Resume only if you accept the spend.
          </Text>
        </div>
        <Button
          variant="accent-soft"
          size="sm"
          onClick={() => {
            if (guard.goalActive) void ipc.prompt("/goal resume");
            if (guard.autoActive) void ipc.prompt("/autonomous on");
            setPaused(false);
            graceUntil.current = Date.now() + GRACE_MS;
          }}
        >
          Resume
        </Button>
      </div>
    );
  }

  // (e2) Budget reached while the loop is still running.
  if (showBudget) {
    return (
      <div role="alert" className="lr-guard lr-guard--warn">
        <span className="lr-guard__dot lr-guard__dot--warn" aria-hidden />
        <div className="lr-guard__main">
          <Text variant="label" weight="semibold" tone="warning">
            Run budget reached — {guard.reason}
          </Text>
          <Text variant="micro" tone="muted">
            The {guard.goalActive ? "goal" : "autonomous"} loop is still working. Pause or stop it to halt the
            spend, or dismiss to keep going.
          </Text>
        </div>
        {guard.goalActive ? (
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              void ipc.prompt("/goal pause");
              setPaused(true);
            }}
          >
            Pause goal
          </Button>
        ) : null}
        {guard.autoActive ? (
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              void ipc.prompt("/autonomous off");
              setPaused(true);
            }}
          >
            Stop autonomous
          </Button>
        ) : null}
        <Button variant="ghost" size="sm" onClick={() => setDismissed(true)}>
          Dismiss
        </Button>
      </div>
    );
  }

  return null;
}

export default RunGuardBanner;
