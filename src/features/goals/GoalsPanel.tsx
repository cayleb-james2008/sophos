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
import { Card, Text, Badge, Button, Input, IconButton, type BadgeTone } from "../../design";
import { useIpc, useConnectionState } from "../../ipc/client";
import type { Goal } from "../../ipc/contract";
import { PlusIcon, ChevronRightIcon, XIcon } from "../sessions/icons";
import { useActionError, ActionErrorBanner } from "../longrunning/useActionError";
import { useStall } from "../longrunning/useStall";
import "./goals.css";

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
      <div className={`goals-head${open ? "" : " goals-head--closed"}`}>
        <div className="goals-headmain">
          <Text variant="label" weight="semibold">
            {title}
          </Text>
          <Text variant="micro" tone="dim" className="goals-headsub">
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
            <span className={`goals-chevron${open ? " is-open" : ""}`}>
              <ChevronRightIcon size={14} />
            </span>
          </IconButton>
        ) : null}
      </div>

      {open ? (
        <div className="goals-body">
          {/* State + action: set a goal up front, then the list. */}
          <div className="goals-section">
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
                className="goals-stalled"
              >
                <div className="goals-stalledmain">
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
              className="goals-form"
            >
              <div className="goals-formmain">
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
          <div className="goals-section">
            <Text variant="micro" tone="dim" uppercase>
              Goals
            </Text>
            {goals.length === 0 ? (
              <div className="goals-empty">
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
              <div className="goals-list">
                {goals.map((g) => {
                  const b = goalBadge(g.status);
                  return (
                    <div
                      key={g.id}
                      className="goals-row"
                    >
                      <span
                        className={`goals-rowdot${g.status === "active" ? " goals-rowdot--active" : g.status === "paused" ? " goals-rowdot--paused" : g.status === "completed" ? " goals-rowdot--completed" : ""}`}
                      />
                      <div className="goals-rowmain">
                        <Text variant="label" weight="medium" className="goals-rowtitle">
                          {g.objective}
                        </Text>
                        <div className="goals-rowbadges">
                          <Badge tone={b.tone} dot>
                            {b.label}
                          </Badge>
                          {g.progress ? (
                            <Text variant="micro" tone="dim" mono className="goals-rowprogress">
                              {g.progress}
                            </Text>
                          ) : null}
                        </div>
                        <div className="goals-rowactions">
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
