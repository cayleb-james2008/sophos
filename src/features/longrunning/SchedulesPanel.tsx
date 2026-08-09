// SchedulesPanel — surfaces one-time and cron scheduled prompts. Lists scheduled
// tasks, lets the operator add a schedule by cron expression + prompt, and
// remove one through the first-class RPC commands (ipc.addSchedule /
// ipc.removeSchedule) that call the daemon's addCronJob / cancelCronJob methods.
// Falls back gracefully to local state in browser/demo mode.
//
// B2/B3: flat, ruled layout matching the other long-running panels — the state
// (any schedules armed?) and the "Add schedule" action lead, list rows are
// plain hairline-ruled lines instead of nested bordered boxes. The dashed empty
// state is kept.

import { useState } from "react";
import { tokens } from "../../design/tokens";
import { Card, Text, Badge, Button, Input, IconButton } from "../../design";
import { useIpc } from "../../ipc/client";
import { PlusIcon, XIcon } from "../sessions/icons";
import { useActionError, ActionErrorBanner } from "./useActionError";
import { estimateNextDue } from "./nextDue";

export interface ScheduleEntry {
  id: string;
  cron: string;
  prompt: string;
  active?: boolean;
}

export interface SchedulesPanelProps {
  /** Seed schedules from daemon state when available. */
  initial?: ScheduleEntry[];
}

const section: React.CSSProperties = {
  borderTop: `1px solid ${tokens.color.line}`,
  paddingTop: tokens.space.lg,
  display: "flex",
  flexDirection: "column",
  gap: tokens.space.md,
};

export function SchedulesPanel({ initial = [] }: SchedulesPanelProps) {
  const ipc = useIpc();
  const [schedules, setSchedules] = useState<ScheduleEntry[]>(initial);
  const [cron, setCron] = useState("");
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const { error, run } = useActionError();

  const add = async () => {
    const c = cron.trim();
    const p = prompt.trim();
    if (!c || !p) return;
    setBusy(true);
    await run(async () => {
      const result = await ipc.addSchedule(c, p);
      setSchedules((prev) => [...prev, { id: result.id, cron: result.cron, prompt: result.prompt, active: result.active }]);
      setCron("");
      setPrompt("");
    }, "Could not add schedule (daemon unreachable?)");
    setBusy(false);
  };

  const remove = async (id: string) => {
    setBusy(true);
    await run(async () => {
      await ipc.removeSchedule(id);
      setSchedules((prev) => prev.filter((s) => s.id !== id));
    }, "Could not remove schedule (daemon unreachable?)");
    setBusy(false);
  };

  const activeCount = schedules.filter((s) => s.active !== false).length;

  return (
    <Card variant="raised" padding="lg" style={{ display: "flex", flexDirection: "column", gap: tokens.space.lg }}>
      {/* State answer: is anything scheduled? */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <Text variant="label" weight="semibold">
          Schedules
        </Text>
        <Badge tone={activeCount > 0 ? "success" : "neutral"} dot>
          {activeCount > 0 ? `${activeCount} scheduled` : "none scheduled"}
        </Badge>
      </div>

      {/* State + action: add a schedule up front. */}
      <div style={section}>
        <Text variant="label" weight="semibold" tone={activeCount > 0 ? "success" : "default"}>
          {activeCount > 0
            ? `${activeCount} schedule${activeCount > 1 ? "s" : ""} armed — add or remove below.`
            : "No schedules — add a cron above."}
        </Text>
        <Text variant="body" tone="muted">
          Schedule a one-time or recurring prompt for the agent. Use a standard cron expression (e.g. "0 9 * * 1-5")
          plus the prompt to deliver when the schedule fires.
        </Text>

        {error ? <ActionErrorBanner message={error} /> : null}

        <div style={{ display: "flex", flexDirection: "column", gap: tokens.space.sm }}>
          <div style={{ display: "flex", gap: tokens.space.sm, alignItems: "flex-end" }}>
            <div style={{ flex: 1 }}>
              <Input
                label="Cron expression"
                placeholder='e.g. "0 9 * * 1-5"'
                value={cron}
                onChange={(e) => setCron(e.target.value)}
                disabled={busy}
              />
            </div>
            <Button
              size="md"
              icon={<PlusIcon size={13} />}
              onClick={() => void add()}
              loading={busy}
              disabled={!cron.trim() || !prompt.trim()}
            >
              Add schedule
            </Button>
          </div>
          <Input
            label="Prompt"
            placeholder="e.g. Review open work and report status"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            disabled={busy}
          />
        </div>
      </div>

      {/* List — plain ruled rows. */}
      <div style={section}>
        <Text variant="micro" tone="dim" uppercase>
          Scheduled jobs
        </Text>
        {schedules.length === 0 ? (
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
              No schedules
            </Text>
            <Text variant="micro" tone="dim">
              A schedule delivers a prompt to the agent on a cron cadence (e.g. "0 9 * * 1-5"). Add one above to
              run recurring or one-time prompts. Scheduled jobs persist and continue while the UI is detached.
            </Text>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: tokens.space.md }}>
            {schedules.map((s) => (
              <div
                key={s.id}
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
                    background: s.active === false ? tokens.color.textDim : tokens.color.success,
                  }}
                />
                <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 1 }}>
                  <Text variant="label" weight="medium" mono>
                    {s.cron}
                  </Text>
                  <Text variant="micro" tone="dim" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {s.prompt}
                  </Text>
                  <Text variant="micro" tone="dim" mono>
                    next run (est.): {estimateNextDue(s.cron) ?? "—"} · last fired: not reported by daemon
                  </Text>
                </div>
                <IconButton title="Remove schedule" onClick={() => void remove(s.id)} tone="danger" size="sm" disabled={busy}>
                  <XIcon size={13} />
                </IconButton>
              </div>
            ))}
          </div>
        )}
      </div>
    </Card>
  );
}

export default SchedulesPanel;
