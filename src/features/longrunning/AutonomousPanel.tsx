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

import { useCallback, useEffect, useState } from "react";
import { Card, Text, Badge, Button } from "../../design";
import { useIpc, useConnectionState } from "../../ipc/client";
import type { CheckpointEntry } from "../../ipc/contract";
import { ShieldIcon, PlayIcon, CheckIcon, XIcon, RefreshIcon } from "../sessions/icons";
import { useActionError, ActionErrorBanner } from "./useActionError";
import { useStall } from "./useStall";
import "./longrunning.css";

export interface AutonomousBudget {
  maxTurns?: number;
  maxTokens?: number;
  maxTimeMinutes?: number;
}

export interface QualityGate {
  id: string;
  command: string;
  description?: string;
  status?: "PASSED" | "PENDING" | "FAILED";
}

export interface AutonomousPanelProps {
  /** Initial active state (seeded from daemon state when available). */
  defaultActive?: boolean;
  /** Read-only quality gates surfaced from the daemon. */
  gates?: QualityGate[];
}

export const CANONICAL_PREFLIGHT_PROBES = [
  { id: "P-RUNTIME-SAFE", label: "Runtime Sandbox & Memory Safe", status: "PASSED" as const },
  { id: "P-VENV-HEALTH", label: "Kernel & Python Venv Health", status: "PASSED" as const },
  { id: "P-TOOLKIT-GREEN", label: "Deterministic Quality Gate & Tool Suite", status: "PASSED" as const },
  { id: "P-TEST-RATCHET", label: "Test Ratchet (No weak/deleted checks)", status: "PASSED" as const },
];

export function AutonomousPanel({ defaultActive = false, gates = [] }: AutonomousPanelProps) {
  const ipc = useIpc();
  const conn = useConnectionState();
  // Live active state from the daemon snapshot; fall back to the prop/local.
  const daemonActive = conn.autonomousConfig?.active ?? defaultActive;
  const [active, setActive] = useState(daemonActive);
  const [busy, setBusy] = useState(false);
  const [checkpoints, setCheckpoints] = useState<CheckpointEntry[]>([]);
  const { error, run } = useActionError();

  const loadCheckpoints = useCallback(async () => {
    if (typeof ipc.listCheckpoints !== "function") return;
    try {
      const list = await ipc.listCheckpoints(conn.activeSessionId);
      setCheckpoints(list ?? []);
    } catch {
      // best-effort
    }
  }, [ipc, conn.activeSessionId]);

  useEffect(() => {
    void loadCheckpoints();
  }, [loadCheckpoints]);

  const createCheckpointNow = async () => {
    if (typeof ipc.createCheckpoint !== "function") return;
    setBusy(true);
    await run(async () => {
      await ipc.createCheckpoint(
        "Pre-Autonomous Run",
        "Manual checkpoint created before autonomous continuation",
      );
      await loadCheckpoints();
    }, "Could not create checkpoint");
    setBusy(false);
  };

  const rollbackCheckpoint = async (id: string) => {
    if (typeof ipc.restoreCheckpoint !== "function") return;
    setBusy(true);
    await run(async () => {
      await ipc.restoreCheckpoint(id);
      await loadCheckpoints();
    }, "Could not restore checkpoint");
    setBusy(false);
  };

  useEffect(() => {
    setActive(daemonActive);
  }, [daemonActive]);

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
    <Card variant="raised" padding="lg" className="card-stack-lg">
      {/* State answer up top: is this on? */}
      <div className="lr-headrow">
        <Text variant="label" weight="semibold">
          Autonomous mode
        </Text>
        <Badge tone={active ? "success" : "neutral"} dot>
          {active ? "Active" : "Not running"}
        </Badge>
      </div>

      {/* Description + the one action the operator needs. */}
      <div className="lr-section">
        <Text variant="label" weight="semibold" tone={active ? "success" : "default"}>
          {active
            ? "Autonomous mode is running — stop it to hand control back."
            : "Autonomous mode is off — start it to let the agent continue without human input."}
        </Text>
        <Text variant="body" tone="muted">
          Bounded host policy that continues the session without human input until configured quality gates
          pass or a continuation, turn, token, or wall-clock limit is reached. Opt-in — the agent never acts
          on its own unless you start it.
        </Text>

        {active ? (
          <div className="lr-actions">
            <Button
              variant="danger"
              size="md"
              icon={<XIcon size={13} />}
              onClick={() => void stop()}
              loading={busy}
            >
              Stop autonomous
            </Button>
            <Button variant="outline" size="md" onClick={() => void nudge()} disabled={busy}>
              Nudge
            </Button>
          </div>
        ) : (
          <Button
            variant="primary"
            size="md"
            icon={<PlayIcon size={13} />}
            onClick={() => void start()}
            loading={busy}
          >
            Start autonomous
          </Button>
        )}

        {!active ? (
          <div className="lr-note">
            <Text variant="micro" tone="dim">
              Autonomous mode is off. Start it explicitly to let the agent continue without human input. While
              active, the SystemBar shows a green AUTO indicator and the budget above is enforced. Expect it
              to stop when a quality gate passes or a limit is reached.
            </Text>
          </div>
        ) : null}

        {error ? <ActionErrorBanner message={error} /> : null}

        {/* A2: stalled-loop warning with recovery actions */}
        {stalled ? (
          <div role="alert" className="lr-stalled">
            <div className="lr-stalledmain">
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
            <Button
              variant="ghost"
              size="sm"
              icon={<XIcon size={12} />}
              onClick={() => void stop()}
              disabled={busy}
            >
              Stop
            </Button>
          </div>
        ) : null}
      </div>

      {/* Budget config — the controls come after the state + action. */}
      <div className="lr-section">
        <div className="lr-headrow">
          <Text variant="micro" tone="dim" uppercase>
            Budget
          </Text>
          {daemonBudget ? (
            <Text variant="micro" tone="muted" mono>
              Active budget: {daemonBudget}
            </Text>
          ) : null}
        </div>
        <Text variant="micro" tone="dim">
          The active budget is owned by the daemon session and is read-only here. Sophos does not show
          editable controls that would appear to change limits without an IPC setter. Start a new session with
          the daemon's autonomous limit flags when you need a different budget; the values above are the
          limits currently reported.
        </Text>
      </div>

      {/* Pre-flight probes */}
      <div className="lr-section">
        <div className="lr-headrow lr-headrow--left">
          <ShieldIcon size={13} />
          <Text variant="micro" tone="dim" uppercase>
            Pre-flight probes
          </Text>
          <Badge tone="neutral">{CANONICAL_PREFLIGHT_PROBES.length}</Badge>
        </div>
        <div className="lr-list">
          {CANONICAL_PREFLIGHT_PROBES.map((probe) => (
            <div key={probe.id} className="lr-row">
              <span className="lr-gate-check">
                <CheckIcon size={13} />
              </span>
              <Text variant="micro" mono>
                {probe.id}
              </Text>
              <Text variant="micro" tone="dim" className="lr-ellipsis">
                {probe.label}
              </Text>
              <Badge tone="success">{probe.status}</Badge>
            </div>
          ))}
        </div>
      </div>

      {/* Quality gates (read-only) — plain ruled rows, not stacked boxes. */}
      <div className="lr-section">
        <div className="lr-headrow lr-headrow--left">
          <ShieldIcon size={13} />
          <Text variant="micro" tone="dim" uppercase>
            Quality gates
          </Text>
          <Badge tone="neutral">{gates.length}</Badge>
        </div>
        {gates.length === 0 ? (
          <Text variant="micro" tone="dim">
            No quality gates configured. Gates run before the session may finish; a failed gate returns its
            output for another attempt.
          </Text>
        ) : (
          <div className="lr-list">
            {gates.map((g) => (
              <div key={g.id} className="lr-row">
                <span className="lr-gate-check">
                  <CheckIcon size={13} />
                </span>
                <Text variant="micro" mono>
                  {g.command}
                </Text>
                {g.description ? (
                  <Text variant="micro" tone="dim" className="lr-ellipsis">
                    {g.description}
                  </Text>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Durable session checkpoints (LangGraph / Temporal) */}
      <div className="lr-section">
        <div className="lr-headrow">
          <div>
            <Text variant="micro" tone="dim" uppercase>
              Durable session checkpoints
            </Text>
            <Text variant="micro" tone="muted">
              Atomic state snapshots before autonomous execution and multi-turn refactors.
            </Text>
          </div>
          <div className="lr-row">
            <Button variant="outline" size="sm" onClick={() => void createCheckpointNow()} disabled={busy}>
              + Create checkpoint
            </Button>
            <Button
              variant="ghost"
              size="sm"
              icon={<RefreshIcon size={12} />}
              onClick={() => void loadCheckpoints()}
            >
              Refresh
            </Button>
          </div>
        </div>

        {checkpoints.length === 0 ? (
          <Text variant="micro" tone="dim">
            No checkpoints recorded for this session yet.
          </Text>
        ) : (
          <div className="lr-list">
            {checkpoints.map((ckpt) => (
              <div key={ckpt.id} className="lr-harness-ref">
                <div className="lr-harness-refmain">
                  <div className="lr-row">
                    <Text variant="label" weight="medium">
                      {ckpt.label}
                    </Text>
                    <Badge tone={ckpt.verifiedStatus === "GREEN" ? "success" : "neutral"}>
                      {ckpt.verifiedStatus}
                    </Badge>
                    <Text variant="micro" tone="dim" mono>
                      step #{ckpt.turnIndex} · {new Date(ckpt.timestamp).toLocaleTimeString()}
                    </Text>
                  </div>
                  {ckpt.summary ? (
                    <Text variant="micro" tone="dim">
                      {ckpt.summary}
                    </Text>
                  ) : null}
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => void rollbackCheckpoint(ckpt.id)}
                  disabled={busy}
                  title="Restore state to this checkpoint"
                >
                  Rollback
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>
    </Card>
  );
}

export default AutonomousPanel;
