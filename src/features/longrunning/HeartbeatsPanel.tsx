// HeartbeatsPanel — surfaces the session's recurring user heartbeat(s). Lists
// active heartbeats, lets the operator set a new one by interval, and remove
// the current heartbeat through the first-class RPC commands (ipc.setHeartbeat /
// ipc.removeHeartbeat) that call the daemon's setHeartbeat / updateHeartbeat
// methods. Falls back gracefully to local state in browser/demo mode.
//
// B2/B3: flat, ruled layout matching the other long-running panels — the state
// (are heartbeats set?) and the "Set heartbeat" action lead, list rows are
// plain hairline-ruled lines instead of nested bordered boxes. The dashed empty
// state is kept.

import { useState } from "react";
import { tokens } from "../../design/tokens";
import { Card, Text, Badge, Button, Input, IconButton } from "../../design";
import { useIpc } from "../../ipc/client";
import { PlusIcon, XIcon } from "../sessions/icons";
import { useActionError, ActionErrorBanner } from "./useActionError";
import { estimateNextDue } from "./nextDue";

export interface Heartbeat {
  id: string;
  interval: string;
  prompt?: string;
  label?: string;
  status?: "active" | "paused";
}

export interface HeartbeatsPanelProps {
  /** Seed heartbeats from daemon state when available. */
  initial?: Heartbeat[];
}

const section: React.CSSProperties = {
  borderTop: `1px solid ${tokens.color.line}`,
  paddingTop: tokens.space.lg,
  display: "flex",
  flexDirection: "column",
  gap: tokens.space.md,
};

export function HeartbeatsPanel({ initial = [] }: HeartbeatsPanelProps) {
  const ipc = useIpc();
  const [heartbeats, setHeartbeats] = useState<Heartbeat[]>(initial);
  const [interval, setInterval] = useState("");
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const { error, run } = useActionError();

  const add = async () => {
    const iv = interval.trim();
    if (!iv) return;
    setBusy(true);
    await run(async () => {
      const result = await ipc.setHeartbeat(iv, prompt.trim() || undefined);
      // setHeartbeat returns ScheduleInfo (the daemon models heartbeats as cron jobs);
      // map it to the Heartbeat UI shape.
      if (result) {
        setHeartbeats((prev) => [
          ...prev,
          { id: result.id, interval: result.cron, prompt: result.prompt || undefined, status: result.active ? "active" : "paused" },
        ]);
      } else {
        // Fallback: daemon returned undefined, use local values.
        setHeartbeats((prev) => [
          ...prev,
          { id: `heartbeat-${Date.now()}`, interval: iv, prompt: prompt.trim() || undefined, status: "active" },
        ]);
      }
      setInterval("");
      setPrompt("");
    }, "Could not set heartbeat (daemon unreachable?)");
    setBusy(false);
  };

  const remove = async (id: string) => {
    setBusy(true);
    await run(async () => {
      await ipc.removeHeartbeat();
      setHeartbeats((prev) => prev.filter((h) => h.id !== id));
    }, "Could not remove heartbeat (daemon unreachable?)");
    setBusy(false);
  };

  const activeCount = heartbeats.filter((h) => h.status === "active").length;

  return (
    <Card variant="raised" padding="lg" style={{ display: "flex", flexDirection: "column", gap: tokens.space.lg }}>
      {/* State answer: is a heartbeat set? */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <Text variant="label" weight="semibold">
          Heartbeats
        </Text>
        <Badge tone={activeCount > 0 ? "success" : "neutral"} dot>
          {activeCount > 0 ? `${activeCount} active` : "none set"}
        </Badge>
      </div>

      {/* State + action: set a heartbeat up front. */}
      <div style={section}>
        <Text variant="body" tone="muted">
          A heartbeat is a visible recurring instruction for the current session, delivered on an interval
          (e.g. "every 10m"). Only one user heartbeat is active at a time.
        </Text>

        {error ? <ActionErrorBanner message={error} /> : null}

        <div style={{ display: "flex", flexDirection: "column", gap: tokens.space.sm }}>
          <div style={{ display: "flex", gap: tokens.space.sm, alignItems: "flex-end" }}>
            <div style={{ flex: 1 }}>
              <Input
                label="Interval"
                placeholder='e.g. "every 5 minutes" or "every 10m"'
                value={interval}
                onChange={(e) => setInterval(e.target.value)}
                disabled={busy}
              />
            </div>
            <Button size="md" icon={<PlusIcon size={13} />} onClick={() => void add()} loading={busy} disabled={!interval.trim()}>
              Set heartbeat
            </Button>
          </div>
          <Input
            label="Instruction (optional)"
            placeholder="e.g. Check the deployment and report meaningful changes"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            disabled={busy}
          />
        </div>
      </div>

      {/* List — plain ruled rows. */}
      <div style={section}>
        <Text variant="micro" tone="dim" uppercase>
          Active heartbeats
        </Text>
        {heartbeats.length === 0 ? (
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
              No heartbeats set
            </Text>
            <Text variant="micro" tone="dim">
              A heartbeat is a visible recurring instruction delivered on an interval (e.g. "every 10m"). Set
              one above to have the agent periodically check in on the session. Only one user heartbeat is
              active at a time, and it persists while the session runs.
            </Text>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: tokens.space.md }}>
            {heartbeats.map((h) => (
              <div
                key={h.id}
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
                    background: h.status === "active" ? tokens.color.success : tokens.color.warning,
                  }}
                />
                <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 1 }}>
                  <Text variant="label" weight="medium" mono>
                    {h.interval}
                  </Text>
                  {h.prompt ? (
                    <Text variant="micro" tone="dim" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {h.prompt}
                    </Text>
                  ) : null}
                  <Text variant="micro" tone="dim" mono>
                    next run (est.): {estimateNextDue(h.interval) ?? "—"} · last fired: not reported by daemon
                  </Text>
                </div>
                <Badge tone={h.status === "active" ? "success" : "warning"} dot>
                  {h.status === "active" ? "Active" : "Paused"}
                </Badge>
                <IconButton title="Remove heartbeat" onClick={() => void remove(h.id)} tone="danger" size="sm" disabled={busy}>
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

export default HeartbeatsPanel;
