// RefinementHistory — surfaces past refinement passes with timestamps and
// descriptions, lets the operator trigger a "refine now" pass (with optional
// instructions — bare runs through ipc.refine(), instructed through
// ipc.prompt("/refine ...")), and roll back to a prior refinement. Falls back
// gracefully to local state in browser/demo mode.

import { useState } from "react";
import { tokens } from "../../design/tokens";
import { Card, Text, Badge, Button, Input, IconButton } from "../../design";
import { useIpc } from "../../ipc/client";
import { SparkIcon, RefreshIcon, XIcon, CheckIcon } from "../sessions/icons";
import { useActionError, ActionErrorBanner } from "./useActionError";

export interface RefinementEntry {
  id: string;
  timestamp?: string;
  description?: string;
  status?: "applied" | "rolled-back";
}

export interface RefinementHistoryProps {
  /** Seed past refinements from daemon state when available. */
  initial?: RefinementEntry[];
}

export function RefinementHistory({ initial = [] }: RefinementHistoryProps) {
  const ipc = useIpc();
  const [refinements, setRefinements] = useState<RefinementEntry[]>(initial);
  const [instructions, setInstructions] = useState("");
  const [busy, setBusy] = useState(false);
  const { error, run } = useActionError();

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
      setRefinements((prev) => [
        {
          id: `refine-${Date.now()}`,
          timestamp: new Date().toISOString(),
          description: text ? `Refined: ${text}` : "Refined on request",
          status: "applied",
        },
        ...prev,
      ]);
      setInstructions("");
    }, "Could not run refinement (daemon unreachable?)");
    setBusy(false);
  };

  const rollback = async (id: string) => {
    setBusy(true);
    await run(async () => {
      await ipc.prompt("/refine rollback " + id);
      setRefinements((prev) => prev.map((r) => (r.id === id ? { ...r, status: "rolled-back" } : r)));
    }, "Could not rollback refinement (daemon unreachable?)");
    setBusy(false);
  };

  return (
    <Card variant="raised" padding="lg" style={{ display: "flex", flexDirection: "column", gap: tokens.space.lg }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: tokens.space.md }}>
          <span
            style={{
              width: 34,
              height: 34,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              borderRadius: tokens.radius.md,
              background: tokens.color.bgOverlay,
              border: `1px solid ${tokens.color.border}`,
              color: tokens.color.textDim,
            }}
          >
            <SparkIcon size={16} />
          </span>
          <Text variant="label" weight="semibold">
            Refinement history
          </Text>
          <Badge tone={refinements.length > 0 ? "accent" : "neutral"} dot>
            {refinements.length}
          </Badge>
        </div>
      </div>

      <Text variant="body" tone="muted">
        Refinement iterates on the current output to tighten it against the goal. Trigger a pass now,
        optionally with instructions, and roll back a prior refinement if a pass regressed.
      </Text>

      {error ? <ActionErrorBanner message={error} /> : null}

      {/* Refine now */}
      <div style={{ display: "flex", flexDirection: "column", gap: tokens.space.sm }}>
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

      {/* List */}
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
            Run a "refine now" pass above; past passes with timestamps and rollback controls appear here.
          </Text>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: tokens.space.sm }}>
          {refinements.map((r) => {
            const rolledBack = r.status === "rolled-back";
            return (
              <div
                key={r.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: tokens.space.md,
                  padding: tokens.space.md,
                  borderRadius: tokens.radius.md,
                  background: tokens.color.bgElevated,
                  border: `1px solid ${tokens.color.border}`,
                }}
              >
                <span
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: "50%",
                    flexShrink: 0,
                    background: rolledBack ? tokens.color.warning : tokens.color.accentHover,
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
                <Badge tone={rolledBack ? "warning" : "success"} dot>
                  {rolledBack ? "Rolled back" : "Applied"}
                </Badge>
                {!rolledBack ? (
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
            );
          })}
        </div>
      )}
    </Card>
  );
}

export default RefinementHistory;
