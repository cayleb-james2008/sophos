// RefinementGateBanner — the always-visible review gate for refinement (A1).
//
// Mounted in the Shell so a pending refinement proposal is surfaced from any
// view, not just the Settings → Refinement panel. When the daemon reports a
// proposed change, this banner appears with the summary and explicit Apply /
// Discard actions — the human holds the pen (D37 / D38 / F17). Reads the
// shared gate store so it stays in sync with the RefinementHistory panel.
//
// P3: the proposed change is now shown as a REAL unified diff (added/removed
// lines) before Apply — not just a text summary. The diff is collapsible and
// collapsed by default so the always-visible banner never dominates. The
// summary line and the explicit Apply/Discard gate are preserved; auto-apply
// stays OFF by default. The diff is built from the event (buildRefinementDiff)
// and never fabricates content the daemon did not report.

import { useState, type CSSProperties } from "react";
import { Text, Button } from "../../design";
import { CheckIcon, XIcon, ChevronRightIcon } from "../sessions/icons";
import { useRefinementGate, describeRefinement } from "./useRefinementGate";
import { DiffView } from "./DiffView";
import "./longrunning.css";

export function RefinementGateBanner() {
  const gate = useRefinementGate();
  const pending = gate.pending;
  const [showDiff, setShowDiff] = useState(false);
  if (!pending) return null;

  const diff = pending.diff ?? [];
  const hasDiff = diff.length > 0;

  return (
    <div role="alert" className="lr-gate">
      <div className="lr-gate__row">
        <span className="lr-gate__dot" aria-hidden />
        <div className="lr-gate__main">
          <Text variant="label" weight="semibold" tone="accent">
            Refinement awaiting your review
          </Text>
          <Text variant="micro" tone="muted" className="lr-gate__desc">
            {describeRefinement(pending.result)}
          </Text>
        </div>
        {hasDiff ? (
          <Button
            variant="ghost"
            size="sm"
            className="lr-gate__diff-toggle"
            icon={
              <ChevronRightIcon
                size={12}
                style={{ "--chevron-rot": showDiff ? "90deg" : "0deg" } as CSSProperties}
              />
            }
            onClick={() => setShowDiff((s) => !s)}
          >
            {showDiff ? "Hide diff" : "Show diff"}
          </Button>
        ) : null}
        <Button variant="primary" size="sm" icon={<CheckIcon size={12} />} onClick={() => gate.apply()}>
          Apply
        </Button>
        <Button variant="outline" size="sm" icon={<XIcon size={12} />} onClick={() => gate.discard()}>
          Discard
        </Button>
      </div>
      {showDiff && hasDiff ? (
        <div className="lr-gate__diff">
          <DiffView lines={diff} />
        </div>
      ) : null}
    </div>
  );
}

export default RefinementGateBanner;
