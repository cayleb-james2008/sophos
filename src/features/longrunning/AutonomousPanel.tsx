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
//
// B2/B3: flattened onto the GeneralPanel rhythm — one flat card, hairline
// `#2a2a2a` rules (not stacked bordered boxes), and the state answer (Active /
// Not running badge) + primary Start/Stop action lead before the budget
// controls. Green is used only as the live/active signal.

import { useState } from "react";
import { tokens } from "../../design/tokens";
import { Card, Text, Badge, Button, Input } from "../../design";
import { useIpc, useConnectionState } from "../../ipc/client";
import { ShieldIcon, PlayIcon, CheckIcon, XIcon } from "../sessions/icons";
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

const section: React.CSSProperties = {
  borderTop: `1px solid ${tokens.color.line}`,
  paddingTop: tokens.space.lg,
  display: "flex",
  flexDirection: "column",
  gap: tokens.space.md,
};

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
      {/* State answer up top: is this on? */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <Text variant="label" weight="semibold">
          Autonomous mode
        </Text>
        <Badge tone={active ? "success" : "neutral"} dot>
          {active ? "Active" : "Not running"}
        </Badge>
      </div>

      {/* Description + the one action the operator needs. */}
      <div style={section}>
        <Text variant="label" weight="semibold" tone={active ? "success" : "default"}>
          {active
            ? "Autonomous mode is running — stop it to hand control back."
            : "Autonomous mode is off — start it to let the agent continue without human input."}
        </Text>
        <Text variant="body" tone="muted">
          Bounded host policy that continues the session without human input until configured quality gates
          pass or a continuation, turn, token, or wall-clock limit is reached. Opt-in — the agent never acts on
          its own unless you start it.
        </Text>

        {active ? (
          <div style={{ display: "flex", gap: tokens.space.sm }}>
            <Button variant="danger" size="md" icon={<XIcon size={13} />} onClick={() => void stop()} loading={busy}>
              Stop autonomous
            </Button>
            <Button variant="outline" size="md" onClick={() => void nudge()} disabled={busy}>
              Nudge
            </Button>
          </div>
        ) : (
          <Button variant="primary" size="md" icon={<PlayIcon size={13} />} onClick={() => void start()} loading={busy}>
            Start autonomous
          </Button>
        )}

        {/* Flattened to a hairline-ruled section rather than a dashed box with
            its own fill (vision-critic D5): a bordered container nested inside
            the card was the last box-in-box on this surface, and its "Not
            running" heading repeated the status badge in the card header. The
            DNA divides with hairlines and whitespace, so this is now an
            explanatory note under a rule, not a second container. */}
        {!active ? (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: tokens.space.sm,
              paddingTop: tokens.space.lg,
              borderTop: `1px solid ${tokens.color.border}`,
            }}
          >
            <Text variant="micro" tone="dim">
              Autonomous mode is off. Start it explicitly to let the agent continue without human input. While
              active, the SystemBar shows a green AUTO indicator and the budget above is enforced. Expect it to
              stop when a quality gate passes or a limit is reached.
            </Text>
          </div>
        ) : null}

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
      </div>

      {/* Budget config — the controls come after the state + action. */}
      <div style={section}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <Text variant="micro" tone="dim" uppercase>
            Budget
          </Text>
          {daemonBudget ? (
            <Text variant="micro" tone="muted" mono>
              Active budget: {daemonBudget}
            </Text>
          ) : null}
        </div>
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
      </div>

      {/* Quality gates (read-only) — plain ruled rows, not stacked boxes. */}
      <div style={section}>
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
              <div key={g.id} style={{ display: "flex", alignItems: "center", gap: tokens.space.sm }}>
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
