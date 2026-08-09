// AutonomousPanel — bounded autonomous mode control. Shows current autonomous
// status (live from ConnectionState.autonomousConfig), lets the operator
// configure turn / token / wall-clock budgets, and start / stop the mode
// through the prompt system (ipc.prompt("/autonomous on|off"), the same
// slash-command pipeline the TUI uses). Quality gates are surfaced read-only.
//
// A2: a stalled-goal/loop guardrail surfaces "no progress for N min" with
// Stop / Nudge recovery. A4: the daemon's active budget is shown read-only and
// the mode is clearly opt-in (Start is explicit; the SystemBar carries an
// always-visible AUTO indicator). Falls back gracefully to local state in
// browser/demo mode.

import { useState } from "react";
import { tokens } from "../../design/tokens";
import { Card, Text, Badge, Button, Input } from "../../design";
import { useIpc, useConnectionState } from "../../ipc/client";
import { ZapIcon, PlayIcon, CheckIcon, ShieldIcon, XIcon } from "../sessions/icons";
import { useActionError, ActionErrorBanner } from "./useActionError";
import { useStall } from "./useStall";

export interface AutonomousBudget {
  maxTurns?: number;
  maxTokens?: number;
  maxTimeMinutes?: number;
}

export interface QualityGate {
  id: string;
  command: string;
  description?: string;
}

export interface AutonomousPanelProps {
  /** Initial active state (seeded from daemon state when available). */
  defaultActive?: boolean;
  /** Read-only quality gates surfaced from the daemon. */
  gates?: QualityGate[];
}

export function AutonomousPanel({ defaultActive = false, gates = [] }: AutonomousPanelProps) {
  const ipc = useIpc();
  const conn = useConnectionState();
  // Live active state from the daemon snapshot; fall back to the prop/local.
  const daemonActive = conn.autonomousConfig?.active ?? defaultActive;
  const [active, setActive] = useState(daemonActive);
  const [maxTurns, setMaxTurns] = useState("");
  const [maxTokens, setMaxTokens] = useState("");
  const [maxTime, setMaxTime] = useState("");
  const [busy, setBusy] = useState(false);
  const { error, run } = useActionError();

  // A2: stalled-loop detection — no activity reported for 5+ min while active.
  const stalled = useStall(
    active,
    JSON.stringify([conn.context?.tokens, conn.queue?.mode, conn.autonomousConfig?.active]),
    5 * 60 * 1000,
  );

  const start = async () => {
    setBusy(true);
    await run(async () => {
      // Route through the prompt system (TUI form) — not the bash transport.
      await ipc.prompt("/autonomous on");
      setActive(true);
    }, "Could not start autonomous mode (daemon unreachable?)");
    setBusy(false);
  };

  const stop = async () => {
    setBusy(true);
    await run(async () => {
      await ipc.prompt("/autonomous off");
      setActive(false);
    }, "Could not stop autonomous mode (daemon unreachable?)");
    setBusy(false);
  };

  const nudge = async () => {
    setBusy(true);
    await run(async () => {
      await ipc.steer("Continue the autonomous run and report progress");
    }, "Could not nudge autonomous mode (daemon unreachable?)");
    setBusy(false);
  };

  // A4: the daemon's active budget, surfaced read-only when present.
  const cfg = conn.autonomousConfig;
  const daemonBudget = cfg
    ? [
        cfg.maxTurns != null ? `${cfg.maxTurns} turns` : null,
        cfg.maxTokens != null ? `${(cfg.maxTokens / 1000).toFixed(0)}k tokens` : null,
        cfg.maxTime ? `${cfg.maxTime}` : null,
      ]
        .filter((x): x is string => Boolean(x))
        .join(" · ")
    : null;

  return (
    <Card variant="raised" padding="lg" style={{ display: "flex", flexDirection: "column", gap: tokens.space.lg }}>
      {/* Header + status */}
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
              background: active ? tokens.color.accentSoft : tokens.color.bgOverlay,
              border: `1px solid ${active ? tokens.color.accentBorder : tokens.color.border}`,
              color: active ? tokens.color.accentHover : tokens.color.textDim,
            }}
          >
            <ZapIcon size={16} />
          </span>
          <Text variant="label" weight="semibold">
            Autonomous mode
          </Text>
        </div>
        <Badge tone={active ? "success" : "neutral"} dot>
          {active ? "Active" : "Inactive"}
        </Badge>
      </div>

      <Text variant="body" tone="muted">
        Bounded host policy that continues the session without human input until configured quality gates
        pass or a continuation, turn, token, or wall-clock limit is reached. Opt-in — the agent never acts on
        its own unless you start it.
      </Text>

      {error ? <ActionErrorBanner message={error} /> : null}

      {/* A2: stalled-loop warning with recovery actions */}
      {stalled ? (
        <div
          role="alert"
          style={{
            display: "flex",
            alignItems: "center",
            gap: tokens.space.md,
            padding: `${tokens.space.sm} ${tokens.space.md}`,
            borderRadius: tokens.radius.md,
            background: tokens.color.warning + "14",
            border: `1px solid ${tokens.color.warning}40`,
          }}
        >
          <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 1 }}>
            <Text variant="label" weight="semibold" tone="warning">
              No progress reported for 5+ min
            </Text>
            <Text variant="micro" tone="muted">
              The autonomous loop may be stalled. Nudge it or stop to halt the run.
            </Text>
          </div>
          <Button variant="outline" size="sm" onClick={() => void nudge()} disabled={busy}>
            Nudge
          </Button>
          <Button variant="ghost" size="sm" icon={<XIcon size={12} />} onClick={() => void stop()} disabled={busy}>
            Stop
          </Button>
        </div>
      ) : null}

      {/* A4: daemon's active budget, read-only */}
      {daemonBudget ? (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: tokens.space.sm,
            padding: `${tokens.space.sm} ${tokens.space.md}`,
            borderRadius: tokens.radius.md,
            background: tokens.color.bgElevated,
            border: `1px solid ${tokens.color.border}`,
          }}
        >
          <ShieldIcon size={13} style={{ color: tokens.color.accentHover, flexShrink: 0 }} />
          <Text variant="micro" tone="muted" mono>
            Active budget: {daemonBudget}
          </Text>
        </div>
      ) : null}

      {/* Budget inputs */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: tokens.space.md }}>
        <Input
          label="Max turns"
          type="number"
          min={1}
          placeholder="e.g. 20"
          value={maxTurns}
          onChange={(e) => setMaxTurns(e.target.value)}
          disabled={active || busy}
        />
        <Input
          label="Max tokens"
          type="number"
          min={1}
          placeholder="e.g. 200000"
          value={maxTokens}
          onChange={(e) => setMaxTokens(e.target.value)}
          disabled={active || busy}
        />
        <Input
          label="Max time (min)"
          type="number"
          min={1}
          placeholder="e.g. 90"
          value={maxTime}
          onChange={(e) => setMaxTime(e.target.value)}
          disabled={active || busy}
        />
      </div>

      {/* Controls */}
      <div style={{ display: "flex", gap: tokens.space.sm }}>
        {active ? (
          <Button variant="danger" size="md" icon={<XIcon size={13} />} onClick={() => void stop()} loading={busy}>
            Stop autonomous
          </Button>
        ) : (
          <Button variant="primary" size="md" icon={<PlayIcon size={13} />} onClick={() => void start()} loading={busy}>
            Start autonomous
          </Button>
        )}
      </div>

      {/* Quality gates (read-only) */}
      <div style={{ display: "flex", flexDirection: "column", gap: tokens.space.sm }}>
        <div style={{ display: "flex", alignItems: "center", gap: tokens.space.sm }}>
          <ShieldIcon size={13} />
          <Text variant="micro" tone="dim" uppercase>
            Quality gates
          </Text>
          <Badge tone="neutral">{gates.length}</Badge>
        </div>
        {gates.length === 0 ? (
          <Text variant="micro" tone="dim">
            No quality gates configured. Gates run before the session may finish; a failed gate returns its output for another attempt.
          </Text>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: tokens.space.sm }}>
            {gates.map((g) => (
              <div
                key={g.id}
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
                <CheckIcon size={13} style={{ color: tokens.color.success, flexShrink: 0 }} />
                <Text variant="micro" mono>
                  {g.command}
                </Text>
                {g.description ? (
                  <Text variant="micro" tone="dim" style={{ flex: 1, textAlign: "right", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {g.description}
                  </Text>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </div>
    </Card>
  );
}

export default AutonomousPanel;
