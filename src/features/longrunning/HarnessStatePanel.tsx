import { useCallback, useEffect, useState } from "react";
import { Badge, Button, Card, Text } from "../../design";
import { useIpc } from "../../ipc/client";
import type { HarnessEntry, HarnessState } from "../../ipc/contract";
import { RefreshIcon, XIcon } from "../sessions/icons";
import "./longrunning.css";

const kinds: Array<HarnessEntry["kind"]> = ["memory", "prompt", "skill", "subagent"];

export function HarnessStatePanel() {
  const ipc = useIpc();
  const [state, setState] = useState<HarnessState>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [filter, setFilter] = useState<"all" | HarnessEntry["kind"]>("all");

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setState(await ipc.getHarnessState());
      setError(undefined);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Continual harness state unavailable");
    } finally {
      setLoading(false);
    }
  }, [ipc]);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 5000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const rollback = async (id: string) => {
    try {
      await ipc.prompt(`/refine rollback ${id}`, { queueIfBusy: true, streamingBehavior: "followUp" });
      window.setTimeout(() => void refresh(), 1200);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Rollback request failed");
    }
  };

  const entries = (state?.entries ?? []).filter((entry) => filter === "all" || entry.kind === filter);

  return (
    <Card variant="raised" padding="lg" style={{ display: "flex", flexDirection: "column", gap: 22 }}>
      <div className="lr-headrow">
        <div>
          <Text variant="label" weight="semibold">Continual harness state</Text>
          <Text variant="micro" tone="dim" mono className="lr-harness-sub">{state?.source ?? "daemon-owned state"}</Text>
        </div>
        <Button variant="ghost" size="sm" icon={<RefreshIcon size={13} />} onClick={() => void refresh()}>Reload</Button>
      </div>
      <Text variant="body" tone="muted">
        Live prompt addendums, memories, reusable skills, and subagent descriptions currently visible to the daemon. Rollback is routed through the daemon's refinement command and remains subject to the existing refinement gate.
      </Text>
      {error ? <Text variant="micro" tone="danger">{error}</Text> : null}

      <div className="lr-row lr-row--wrap">
        <Button variant={filter === "all" ? "accent-soft" : "ghost"} size="sm" onClick={() => setFilter("all")}>All · {state?.entries.length ?? 0}</Button>
        {kinds.map((kind) => (
          <Button key={kind} variant={filter === kind ? "accent-soft" : "ghost"} size="sm" onClick={() => setFilter(kind)}>{kind} · {state?.entries.filter((entry) => entry.kind === kind).length ?? 0}</Button>
        ))}
      </div>

      {loading && !state ? <Text variant="body" tone="dim">Reading continual harness state from the live daemon…</Text> : null}
      {!loading && entries.length === 0 ? <Text variant="body" tone="dim">No saved entries in this scope yet.</Text> : null}
      <div className="lr-list">
        {entries.map((entry) => (
          <div key={`${entry.scope ?? "global"}:${entry.kind}:${entry.id}`} className="lr-harness-entry">
            <div className="lr-row">
              <Text variant="label" weight="medium">{entry.title}</Text>
              <Badge tone={entry.scope === "local" ? "info" : "neutral"}>{entry.scope ?? "global"}</Badge>
              <Badge tone="accent">{entry.kind}</Badge>
              {entry.version ? <Text variant="micro" tone="dim" mono>v{entry.version}</Text> : null}
            </div>
            <Text variant="body" tone="muted" className="lr-harness-content">{entry.content}</Text>
            {entry.kind === "skill" && entry.reference ? <Text variant="micro" tone="dim" mono>reference {JSON.stringify(entry.reference)}</Text> : null}
            {entry.path ? <Text variant="micro" tone="dim" mono className="lr-harness-path">{entry.path}</Text> : null}
          </div>
        ))}
      </div>

      <div className="lr-section">
        <div className="lr-headrow">
          <Text variant="micro" tone="dim" uppercase>Refinement / rollback history</Text>
          <Badge tone="neutral">{state?.refinements.length ?? 0}</Badge>
        </div>
        {state?.refinements.length ? state.refinements.slice().reverse().map((refinement) => (
          <div key={refinement.id} className="lr-harness-ref">
            <div className="lr-harness-refmain">
              <Text variant="label" className="lr-harness-refsum">{refinement.summary ?? refinement.trigger ?? refinement.id}</Text>
              <Text variant="micro" tone="dim" mono>{refinement.timestamp ?? refinement.id}{refinement.rollbackOf ? ` · rollback of ${refinement.rollbackOf}` : ""}</Text>
            </div>
            <Button variant="ghost" size="sm" icon={<XIcon size={12} />} onClick={() => void rollback(refinement.id)} title="Request rollback">Rollback</Button>
          </div>
        )) : <Text variant="body" tone="dim">No daemon refinement records yet.</Text>}
      </div>
    </Card>
  );
}
