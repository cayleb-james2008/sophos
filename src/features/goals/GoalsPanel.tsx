// GoalsPanel — surfaces the session's persistent goals (the long-running
// feature set). Renders live from ConnectionState.goals (via useConnectionState)
// and drives creation / pause / resume / clear through the prompt system
// (ipc.prompt("/goal ..."), the same slash-command pipeline the TUI uses).
// It is fully self-contained (reads its own IPC state), so it can be mounted
// anywhere in the shell.
//
// B2/B3: reshaped to the same flat, ruled layout as the other long-running
// panels — one card, hairline `#2a2a2a` rules, the active-goal state and the
// "Set goal" action leading, and plain rows instead of nested bordered boxes.
// The dashed empty state is kept. Goals are durable and only completion marks
// them done.

import { useEffect, useState } from "react";
import { tokens } from "../../design/tokens";
import { Card, Text, Badge, Button, Input, IconButton, type BadgeTone } from "../../design";
import { useIpc, useConnectionState } from "../../ipc/client";
import type { Goal } from "../../ipc/contract";
import { PlusIcon, ChevronRightIcon, XIcon } from "../sessions/icons";
import { useActionError, ActionErrorBanner } from "../longrunning/useActionError";
import { useStall } from "../longrunning/useStall";

function goalBadge(status: Goal["status"]): { label: string; tone: BadgeTone } {
  switch (status) {
    case "active":
      return { label: "Active", tone: "success" };
    case "paused":
      return { label: "Paused", tone: "warning" };
    case "completed":
      return { label: "Completed", tone: "accent" };
    case "cleared":
      return { label: "Cleared", tone: "neutral" };
  }
}

export interface GoalsPanelProps {
  /** Start expanded (default true). */
  defaultOpen?: boolean;
  /** Allow collapse/expand of the panel body (default true). */
  collapsible?: boolean;
  /** Optional header title override. */
  title?: string;
}

const section: React.CSSProperties = {
  borderTop: `1px solid ${tokens.color.line}`,
  paddingTop: tokens.space.lg,
  display: "flex",
  flexDirection: "column",
  gap: tokens.space.md,
};

export function GoalsPanel({ defaultOpen = true, collapsible = true, title = "Goals" }: GoalsPanelProps) {
  const ipc = useIpc();
  // Live goals from the daemon snapshot stream.
  const connGoals = useConnectionState().goals;

  // Local mirror so optimistic updates (create / pause / clear) show instantly
  // in browser/demo mode where runCommand is a no-op and no snapshot returns.
  const [goals, setGoals] = useState<Goal[]>([]);
  const [open, setOpen] = useState(defaultOpen);
  const [objective, setObjective] = useState("");
  const [busy, setBusy] = useState(false);
  const { error, run, clearError } = useActionError();

  useEffect(() => {
    setGoals(connGoals ?? []);
  }, [connGoals]);

  const activeCount = goals.filter((g) => g.status === "active").length;

  // A2: stalled-goal detection — no progress reported for 5+ min while active.
  const stalled = useStall(activeCount > 0, JSON.stringify(goals), 5 * 60 * 1000);

  const nudge = async () => {
    setBusy(true);
    await run(async () => {
      await ipc.steer("Continue the active goal and report progress");
    }, "Could not nudge the goal (daemon unreachable?)");
    setBusy(false);
  };

  const setGoal = async () => {
    const text = objective.trim();
    if (!text) return;
    setBusy(true);
    await run(async () => {
      // Route through the prompt system (TUI form) — not the bash transport.
      await ipc.prompt("/goal " + text);
      // Optimistic — in Tauri mode the daemon's snapshot reconciles this.
      setGoals((prev) => [...prev, { id: `goal-${Date.now()}`, objective: text, status: "active", progress: undefined }]);
      setObjective("");
    }, "Could not set goal (daemon unreachable?)");
    setBusy(false);
  };

  const update = async (action: "pause" | "resume" | "clear", id: string) => {
    setBusy(true);
    await run(async () => {
      // TUI slash form. The daemon owns a single persistent goal, so the verb
      // targets it directly; `id` drives which row the local list updates.
      await ipc.prompt("/goal " + action);
      setGoals((prev) =>
        prev.map((g) =>
          g.id === id
            ? {
                ...g,
                status:
                  action === "pause"
                    ? "paused"
                    : action === "resume"
                      ? "active"
                      : "cleared",
              }
            : g,
        ),
      );
    }, "Could not update goal (daemon unreachable?)");
    setBusy(false);
  };

  return (
    <Card variant="raised" padding="none" style={{ display: "flex", flexDirection: "column", overflow: "hidden" }}>
      {/* Header — the active-goal state answer. */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: tokens.space.md,
          padding: `${tokens.space.md} ${tokens.space.lg}`,
          borderBottom: open ? `1px solid ${tokens.color.border}` : "none",
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <Text variant="label" weight="semibold">
            {title}
          </Text>
          <Text variant="micro" tone="dim" style={{ marginLeft: tokens.space.sm }}>
            {activeCount > 0 ? `${activeCount} active` : "no active goals"}
          </Text>
        </div>
        <Badge tone={activeCount > 0 ? "success" : "neutral"} dot>
          {goals.length}
        </Badge>
        {collapsible ? (
          <IconButton
            title={open ? "Collapse" : "Expand"}
            onClick={() => setOpen((o) => !o)}
            size="sm"
          >
            <span style={{ display: "inline-flex", transform: open ? "rotate(90deg)" : "none", transition: "transform 160ms cubic-bezier(0.16,1,0.3,1)" }}>
              <ChevronRightIcon size={14} />
            </span>
          </IconButton>
        ) : null}
      </div>

      {open ? (
        <div style={{ display: "flex", flexDirection: "column", gap: tokens.space.lg, padding: tokens.space.lg }}>
          {/* State + action: set a goal up front, then the list. */}
          <div style={section}>
            <Text variant="label" weight="semibold" tone={activeCount > 0 ? "success" : "default"}>
              {activeCount > 0
                ? `${activeCount} active goal${activeCount > 1 ? "s" : ""} in progress — manage or set another.`
                : "No active goals — set one to start."}
            </Text>
            <Text variant="body" tone="muted">
              A goal is a durable objective the agent keeps working toward across turns until it's completed,
              paused, budget-limited, or cleared. Set one to start — it persists even when you detach, and the
              agent keeps prompting on it after ordinary turns.
            </Text>

            {error ? <ActionErrorBanner message={error} /> : null}

            {/* A2: stalled-goal warning with recovery actions */}
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
                    The active goal may be stalled. Nudge it or pause to stop the loop.
                  </Text>
                </div>
                <Button variant="outline" size="sm" onClick={() => void nudge()} disabled={busy}>
                  Nudge
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  icon={<XIcon size={12} />}
                  onClick={() => {
                    const active = goals.find((g) => g.status === "active");
                    if (active) void update("pause", active.id);
                  }}
                  disabled={busy}
                >
                  Pause
                </Button>
              </div>
            ) : null}

            {/* Set goal */}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                clearError();
                void setGoal();
              }}
              style={{ display: "flex", gap: tokens.space.sm, alignItems: "flex-end" }}
            >
              <div style={{ flex: 1 }}>
                <Input
                  label="Set goal"
                  placeholder="e.g. Ship the release and verify every artifact"
                  value={objective}
                  onChange={(e) => setObjective(e.target.value)}
                  disabled={busy}
                />
              </div>
              <Button size="md" loading={busy} icon={<PlusIcon size={13} />} disabled={!objective.trim()}>
                Set
              </Button>
            </form>
          </div>

          {/* List — plain ruled rows, not nested bordered boxes. */}
          <div style={section}>
            <Text variant="micro" tone="dim" uppercase>
              Goals
            </Text>
            {goals.length === 0 ? (
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
                  No active goals
                </Text>
                <Text variant="micro" tone="dim">
                  A goal is a durable objective the agent keeps working toward across turns until it's completed,
                  paused, budget-limited, or cleared. Set one above to start — it persists even when you detach,
                  and the agent keeps prompting on it after ordinary turns.
                </Text>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: tokens.space.md }}>
                {goals.map((g) => {
                  const b = goalBadge(g.status);
                  return (
                    <div
                      key={g.id}
                      style={{
                        display: "flex",
                        alignItems: "flex-start",
                        gap: tokens.space.md,
                      }}
                    >
                      <span
                        style={{
                          marginTop: 3,
                          width: 8,
                          height: 8,
                          borderRadius: "50%",
                          flexShrink: 0,
                          background:
                            g.status === "active"
                              ? tokens.color.success
                              : g.status === "paused"
                                ? tokens.color.warning
                                : g.status === "completed"
                                  ? tokens.color.accentHover
                                  : tokens.color.textDim,
                        }}
                      />
                      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 4 }}>
                        <Text variant="label" weight="medium" style={{ lineHeight: tokens.font.leading.normal }}>
                          {g.objective}
                        </Text>
                        <div style={{ display: "flex", alignItems: "center", gap: tokens.space.sm }}>
                          <Badge tone={b.tone} dot>
                            {b.label}
                          </Badge>
                          {g.progress ? (
                            <Text variant="micro" tone="dim" mono style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                              {g.progress}
                            </Text>
                          ) : null}
                        </div>
                        <div style={{ display: "flex", gap: tokens.space.sm, marginTop: 2 }}>
                          {g.status === "active" ? (
                            <Button variant="ghost" size="sm" onClick={() => void update("pause", g.id)} disabled={busy}>
                              Pause
                            </Button>
                          ) : null}
                          {g.status === "paused" ? (
                            <Button variant="accent-soft" size="sm" onClick={() => void update("resume", g.id)} disabled={busy}>
                              Resume
                            </Button>
                          ) : null}
                          {g.status !== "cleared" ? (
                            <Button variant="ghost" size="sm" icon={<XIcon size={12} />} onClick={() => void update("clear", g.id)} disabled={busy}>
                              Clear
                            </Button>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            <Text variant="micro" tone="dim">
              Goals persist across turns. Only explicit completion marks a goal done — pausing and clearing are available here.
            </Text>
          </div>
        </div>
      ) : null}
    </Card>
  );
}

export default GoalsPanel;
