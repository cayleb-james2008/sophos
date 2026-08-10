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

import { useState } from "react";
import { tokens } from "../../design/tokens";
import { Text, Button } from "../../design";
import { CheckIcon, XIcon, ChevronRightIcon } from "../sessions/icons";
import { useRefinementGate, describeRefinement } from "./useRefinementGate";
import { DiffView } from "./DiffView";

export function RefinementGateBanner() {
  const gate = useRefinementGate();
  const pending = gate.pending;
  const [showDiff, setShowDiff] = useState(false);
  if (!pending) return null;

  const diff = pending.diff ?? [];
  const hasDiff = diff.length > 0;

  return (
    <div
      role="alert"
      style={{
        flexShrink: 0,
        background: tokens.color.accentSoft,
        borderBottom: `1px solid ${tokens.color.accentBorder}`,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: tokens.space.md,
          padding: `${tokens.space.sm} ${tokens.space.xl}`,
        }}
      >
        <span
          style={{
            width: 8,
            height: 8,
            borderRadius: "50%",
            background: tokens.color.accentHover,
            flexShrink: 0,
          }}
          aria-hidden
        />
        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 1 }}>
          <Text variant="label" weight="semibold" tone="accent">
            Refinement awaiting your review
          </Text>
          <Text variant="micro" tone="muted" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {describeRefinement(pending.result)}
          </Text>
        </div>
        {hasDiff ? (
          <Button
            variant="ghost"
            size="sm"
            icon={
              <ChevronRightIcon
                size={12}
                style={{
                  transform: showDiff ? "rotate(90deg)" : "none",
                  transition: `transform ${tokens.motion.fast} ${tokens.motion.ease}`,
                }}
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
        <div
          style={{
            padding: `0 ${tokens.space.xl} ${tokens.space.sm}`,
            borderTop: `1px solid ${tokens.color.accentBorder}`,
          }}
        >
          <DiffView lines={diff} />
        </div>
      ) : null}
    </div>
  );
}

export default RefinementGateBanner;
