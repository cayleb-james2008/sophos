// GoalsPanel — surfaces the session's persistent goals (the long-running
// feature set). Renders live from ConnectionState.goals (via useConnectionState)
// and drives creation / pause / resume / clear through the prompt system
// (ipc.prompt("/goal ..."), the same slash-command pipeline the TUI uses).
// It is fully self-contained (reads its own IPC state), so it can be mounted
// anywhere in the shell.
//
// MOUNT NOTE (for the orchestrator): this panel belongs in the Chat view area —
// as a right-hand rail beside the conversation, or a slide-in overlay. ChatView.tsx
// is intentionally NOT edited here (it is owned by another agent in parallel). To
// mount: wrap the chat surface so <GoalsPanel /> renders beside <ChatView />, e.g.
//   <div style={{ display: "flex", height: "100%" }}>
//     <div style={{ flex: 1, minWidth: 0 }}><ChatView /></div>
//     <GoalsPanel />
//   </div>
// or slide it in as an overlay from a toggle in the chat header. The panel handles
// its own empty / loading states and needs no props.

import { useEffect, useState } from "react";
import { tokens } from "../../design/tokens";
import { Card, Text, Badge, Button, Input, IconButton, type BadgeTone } from "../../design";
import { useIpc, useConnectionState } from "../../ipc/client";
import type { Goal } from "../../ipc/contract";
import { TargetIcon, PlusIcon, ChevronRightIcon, XIcon } from "../sessions/icons";
import { useActionError, ActionErrorBanner } from "../longrunning/useActionError";

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
    <Card
      variant="raised"
      padding="none"
      style={{
        display: "flex",
        flexDirection: "column",
        minWidth: 280,
        maxWidth: 360,
        alignSelf: "flex-start",
        overflow: "hidden",
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: tokens.space.md,
          padding: `${tokens.space.md} ${tokens.space.lg}`,
          borderBottom: open ? `1px solid ${tokens.color.border}` : "none",
        }}
      >
        <span
          style={{
            width: 30,
            height: 30,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            borderRadius: tokens.radius.md,
            background: tokens.color.accentSoft,
            border: `1px solid ${tokens.color.accentBorder}`,
            color: tokens.color.accentHover,
          }}
        >
          <TargetIcon size={15} />
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <Text variant="label" weight="semibold">
            {title}
          </Text>
          {activeCount > 0 ? (
            <Text variant="micro" tone="dim">
              {activeCount} active
            </Text>
          ) : null}
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
          {/* Error feedback (e.g. daemon unreachable) */}
          {error ? (
            <ActionErrorBanner message={error} />
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

          {/* List */}
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
                Set a goal above and the agent will keep working toward it across turns until it's completed, paused, budget-limited, or cleared.
              </Text>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: tokens.space.sm }}>
              {goals.map((g) => {
                const b = goalBadge(g.status);
                return (
                  <div
                    key={g.id}
                    style={{
                      display: "flex",
                      alignItems: "flex-start",
                      gap: tokens.space.md,
                      padding: tokens.space.md,
                      borderRadius: tokens.radius.md,
                      background: tokens.color.bgElevated,
                      border: `1px solid ${tokens.color.border}`,
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
                        boxShadow: g.status === "active" ? `0 0 8px ${tokens.color.success}66` : undefined,
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
      ) : null}
    </Card>
  );
}

export default GoalsPanel;
