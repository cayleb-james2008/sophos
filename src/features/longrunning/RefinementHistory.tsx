// RefinementHistory — the review-and-approve gate for refinement (A1).
//
// Research D37 / D38 / F17: a self-editing loop with no human gate is how a
// system drifts silently. When a `refinement_result` event arrives, the
// proposed change is held as a *pending proposal* and the user must explicitly
// Apply (or Discard) before it is accepted into the session's refinement
// record. Auto-apply is an explicit opt-in, OFF by default.
//
// The panel reads the shared gate store (useRefinementGate) so it stays in sync
// with the always-visible SystemBar indicator. "Refine now" triggers a pass via
// ipc.refine() (bare) or ipc.prompt("/refine ...") (instructed); the result
// arrives as a refinement_result event and is gated here. Rollback routes
// through /refine rollback <id> (the same slash-command pipeline the TUI uses).
//
// B2/B3: restyled to the flat, ruled family layout. The behaviour is untouched —
// the pending proposal stays an explicit green human-gate box with Apply/Discard,
// and auto-apply stays OFF by default (driven by useRefinementGate).

import { useState } from "react";
import { tokens } from "../../design/tokens";
import { Card, Text, Badge, Button, Input, IconButton } from "../../design";
import { useIpc } from "../../ipc/client";
import type { RefinementResult } from "../../ipc/contract";
import { RefreshIcon, XIcon, CheckIcon, ChevronRightIcon } from "../sessions/icons";
import { useActionError, ActionErrorBanner } from "./useActionError";
import { useRefinementGate, buildRefinementDiff } from "./useRefinementGate";
import { DiffView } from "./DiffView";

export interface RefinementEntry {
  id: string;
  timestamp?: string;
  description?: string;
  status?: "applied" | "discarded" | "rolled-back";
  result?: RefinementResult;
}

export interface RefinementHistoryProps {
  /** Seed past refinements from daemon state when available. */
  initial?: RefinementEntry[];
}

const section: React.CSSProperties = {
  borderTop: `1px solid ${tokens.color.line}`,
  paddingTop: tokens.space.lg,
  display: "flex",
  flexDirection: "column",
  gap: tokens.space.md,
};

export function RefinementHistory({ initial = [] }: RefinementHistoryProps) {
  const ipc = useIpc();
  const gate = useRefinementGate();
  const [instructions, setInstructions] = useState("");
  const [busy, setBusy] = useState(false);
  const [openDiffs, setOpenDiffs] = useState<Set<string>>(new Set());
  const { error, run } = useActionError();

  const toggleDiff = (id: string) => {
    setOpenDiffs((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const refineNow = async () => {
    setBusy(true);
    await run(async () => {
      const text = instructions.trim();
      if (text) {
        // With instructions — route through the prompt system (TUI form).
        await ipc.prompt("/refine " + text);
      } else {
        // Bare refine is a first-class RPC.
        await ipc.refine();
      }
      setInstructions("");
    }, "Could not run refinement (daemon unreachable?)");
    setBusy(false);
  };

  const rollback = async (id: string) => {
    setBusy(true);
    await run(async () => {
      await ipc.prompt("/refine rollback " + id);
      // The gate store marks the entry rolled back.
      const { markRolledBack } = await import("./useRefinementGate");
      markRolledBack(id);
    }, "Could not rollback refinement (daemon unreachable?)");
    setBusy(false);
  };

  const pending = gate.pending;
  const refinements = gate.history.length > 0 ? gate.history : initial;

  return (
    <Card variant="raised" padding="lg" style={{ display: "flex", flexDirection: "column", gap: tokens.space.lg }}>
      {/* State: how many passes, is one awaiting review? */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <Text variant="label" weight="semibold">
          Refinement history
        </Text>
        <Badge tone={pending ? "accent" : refinements.length > 0 ? "accent" : "neutral"} dot>
          {pending ? "1 awaiting review" : `${refinements.length} recorded`}
        </Badge>
      </div>

      <div style={section}>
        <Text variant="label" weight="semibold" tone={pending ? "accent" : "default"}>
          {pending
            ? "One proposed change awaits your review — apply or discard it below."
            : "No pending changes — run a refine pass when ready."}
        </Text>
        <Text variant="body" tone="muted">
          Refinement iterates on the agent's own instructions to tighten them against the goal. A proposed
          change is held for your review — apply it only if you approve. Roll back a prior pass if it regressed.
        </Text>

        {/* Trust note — D37/D38: the human holds the pen. */}
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: tokens.space.sm,
            padding: `${tokens.space.sm} ${tokens.space.md}`,
            borderRadius: tokens.radius.md,
            background: tokens.color.warning + "14",
            border: `1px solid ${tokens.color.warning}40`,
          }}
        >
          <span style={{ color: tokens.color.warning, fontSize: 12, lineHeight: 1, flexShrink: 0, marginTop: 2 }}>!</span>
          <Text variant="micro" tone="muted">
            Refinement edits the agent's own instructions and runs with your OS permissions — it is not a
            sandbox. Review every proposed change before applying.
          </Text>
        </div>

        {error ? <ActionErrorBanner message={error} /> : null}
      </div>

      {/* Pending proposal — the human gate, kept prominent. */}
      {pending ? (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: tokens.space.md,
            padding: tokens.space.lg,
            borderRadius: tokens.radius.md,
            background: tokens.color.accentSoft,
            border: `1px solid ${tokens.color.accentBorder}`,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: tokens.space.sm }}>
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                background: tokens.color.accentHover,
                flexShrink: 0,
              }}
            />
            <Text variant="label" weight="semibold" tone="accent">
              Proposed refinement — awaiting your review
            </Text>
          </div>

          {pending.result.summary ? (
            <Text variant="body">{pending.result.summary}</Text>
          ) : null}
          {pending.result.rationale ? (
            <Text variant="micro" tone="muted">
              Rationale: {pending.result.rationale}
            </Text>
          ) : null}
          {pending.result.expectedOutcome ? (
            <Text variant="micro" tone="muted">
              Expected outcome: {pending.result.expectedOutcome}
            </Text>
          ) : null}

          {(pending.result.appliedEdits ?? []).length > 0 ? (
            <div style={{ display: "flex", flexDirection: "column", gap: tokens.space.sm }}>
              <Text variant="micro" tone="dim" uppercase>
                Proposed edits
              </Text>
              {(pending.result.appliedEdits ?? []).map((e, i) => (
                <div
                  key={e.id ?? i}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: tokens.space.sm,
                    padding: tokens.space.sm,
                    borderRadius: tokens.radius.md,
                    background: tokens.color.bgElevated,
                    border: `1px solid ${tokens.color.border}`,
                  }}
                >
                  <span
                    style={{
                      width: 6,
                      height: 6,
                      borderRadius: "50%",
                      flexShrink: 0,
                      background: e.applied ? tokens.color.success : tokens.color.warning,
                    }}
                  />
                  <Text variant="micro" mono style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {e.title ?? e.action ?? e.kind ?? "edit"}
                  </Text>
                  <Badge tone={e.applied ? "success" : "warning"} dot>
                    {e.applied ? "Applied" : "Proposed"}
                  </Badge>
                </div>
              ))}
            </div>
          ) : null}

          <div style={{ display: "flex", gap: tokens.space.sm }}>
            <Button variant="primary" size="md" icon={<CheckIcon size={13} />} onClick={() => gate.apply()}>
              Apply
            </Button>
            <Button variant="outline" size="md" icon={<XIcon size={13} />} onClick={() => gate.discard()}>
              Discard
            </Button>
          </div>
        </div>
      ) : null}

      {/* Auto-apply opt-in (OFF by default) — plain ruled row. */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: tokens.space.md,
          borderTop: `1px solid ${tokens.color.line}`,
          paddingTop: tokens.space.lg,
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <Text variant="label" weight="medium">
            Auto-apply refinements
          </Text>
          <Text variant="micro" tone="dim">
            When off (default), every proposed change waits for your explicit Apply.
          </Text>
        </div>
        <Button
          type="button"
          role="switch"
          aria-checked={gate.autoApply}
          onClick={() => gate.setAutoApply(!gate.autoApply)}
          variant={gate.autoApply ? "accent-soft" : "ghost"}
          style={{
            width: 40,
            height: 22,
            borderRadius: 0,
            border: `1px solid ${tokens.color.border}`,
            background: gate.autoApply ? tokens.color.accent : tokens.color.bgRaised,
            position: "relative",
            cursor: "pointer",
            padding: 0,
            flexShrink: 0,
            transition: "background 120ms ease",
          }}
        >
          <span
            style={{
              position: "absolute",
              top: 2,
              left: gate.autoApply ? 20 : 2,
              width: 16,
              height: 16,
              borderRadius: "50%",
              background: tokens.color.text,
              transition: "left 120ms ease",
            }}
          />
        </Button>
      </div>

      {/* Run a refinement — the primary action. */}
      <div style={section}>
        <Text variant="micro" tone="dim" uppercase>
          Run a refinement
        </Text>
        <Input
          label="Instructions (optional)"
          placeholder="e.g. Preserve the failing tests and remaining migration steps"
          value={instructions}
          onChange={(e) => setInstructions(e.target.value)}
          disabled={busy}
        />
        <div>
          <Button variant="accent-soft" size="md" icon={<RefreshIcon size={13} />} onClick={() => void refineNow()} loading={busy}>
            Refine now
          </Button>
        </div>
      </div>

      {/* History — plain ruled rows. */}
      <div style={section}>
        <Text variant="micro" tone="dim" uppercase>
          History
        </Text>
        {refinements.length === 0 ? (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: tokens.space.sm,
              padding: tokens.space.lg,
              borderRadius: tokens.radius.md,
              background: tokens.color.bgElevated,
              border: `1px dashed ${tokens.color.borderStrong}`,
            }}
          >
            <Text variant="label" tone="muted">
              No refinements yet
            </Text>
            <Text variant="micro" tone="dim">
              Run a "refine now" pass above. When the daemon reports a proposed change it appears here for your
              review — apply it to accept, discard to reject. Past passes with timestamps and rollback controls
              are listed below.
            </Text>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: tokens.space.md }}>
            {refinements.map((r) => {
              const rolledBack = r.status === "rolled-back";
              const discarded = r.status === "discarded";
              const hasEdits = (r.result?.appliedEdits ?? []).length > 0;
              const diffOpen = openDiffs.has(r.id);
              return (
                <div key={r.id} style={{ display: "flex", flexDirection: "column", gap: tokens.space.sm }}>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: tokens.space.md,
                    }}
                  >
                    <span
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: "50%",
                        flexShrink: 0,
                        background: rolledBack
                          ? tokens.color.warning
                          : discarded
                            ? tokens.color.textDim
                            : tokens.color.accentHover,
                      }}
                    />
                    <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 1 }}>
                      <Text variant="label" weight="medium" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {r.description ?? "Refinement"}
                      </Text>
                      {r.timestamp ? (
                        <Text variant="micro" tone="dim" mono>
                          {new Date(r.timestamp).toLocaleString()}
                        </Text>
                      ) : null}
                    </div>
                    {hasEdits ? (
                      <Button
                        variant="ghost"
                        type="button"
                        onClick={() => toggleDiff(r.id)}
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 4,
                          background: "transparent",
                          border: "none",
                          color: tokens.color.textDim,
                          fontFamily: tokens.font.sans,
                          fontSize: tokens.font.size.xs,
                          cursor: "pointer",
                          padding: "2px 4px",
                        }}
                      >
                        <ChevronRightIcon
                          size={11}
                          style={{
                            transform: diffOpen ? "rotate(90deg)" : "none",
                            transition: `transform ${tokens.motion.fast} ${tokens.motion.ease}`,
                          }}
                        />
                        {diffOpen ? "Hide diff" : "Show diff"}
                      </Button>
                    ) : null}
                    <Badge
                      tone={rolledBack ? "warning" : discarded ? "neutral" : "success"}
                      dot
                    >
                      {rolledBack ? "Rolled back" : discarded ? "Discarded" : "Applied"}
                    </Badge>
                    {!rolledBack && !discarded ? (
                      <IconButton
                        title="Rollback this refinement"
                        onClick={() => void rollback(r.id)}
                        tone="danger"
                        size="sm"
                        disabled={busy}
                      >
                        <XIcon size={13} />
                      </IconButton>
                    ) : (
                      <span style={{ color: tokens.color.textDim, display: "inline-flex" }}>
                        <CheckIcon size={13} />
                      </span>
                    )}
                  </div>
                  {hasEdits && diffOpen && r.result ? (
                    <div style={{ paddingLeft: tokens.space.lg }}>
                      <DiffView lines={buildRefinementDiff(r.result)} />
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </Card>
  );
}

export default RefinementHistory;
