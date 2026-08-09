// RefinementGateBanner — the always-visible review gate for refinement (A1).
//
// Mounted in the Shell so a pending refinement proposal is surfaced from any
// view, not just the Settings → Refinement panel. When the daemon reports a
// proposed change, this banner appears with the summary and explicit Apply /
// Discard actions — the human holds the pen (D37 / D38 / F17). Reads the
// shared gate store so it stays in sync with the RefinementHistory panel.

import { tokens } from "../../design/tokens";
import { Text, Button } from "../../design";
import { CheckIcon, XIcon } from "../sessions/icons";
import { useRefinementGate, describeRefinement } from "./useRefinementGate";

export function RefinementGateBanner() {
  const gate = useRefinementGate();
  const pending = gate.pending;
  if (!pending) return null;

  return (
    <div
      role="alert"
      style={{
        flexShrink: 0,
        display: "flex",
        alignItems: "center",
        gap: tokens.space.md,
        padding: `${tokens.space.sm} ${tokens.space.xl}`,
        background: tokens.color.accentSoft,
        borderBottom: `1px solid ${tokens.color.accentBorder}`,
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
      <Button variant="primary" size="sm" icon={<CheckIcon size={12} />} onClick={() => gate.apply()}>
        Apply
      </Button>
      <Button variant="outline" size="sm" icon={<XIcon size={12} />} onClick={() => gate.discard()}>
        Discard
      </Button>
    </div>
  );
}

export default RefinementGateBanner;
