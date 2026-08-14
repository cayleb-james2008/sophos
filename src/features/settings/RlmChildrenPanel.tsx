// RlmChildrenPanel — RLM children (subagents) card.

import { Text, Card, Badge, Button, type BadgeTone } from "../../design";
import type { RlmChild } from "../../ipc/contract";
import { LayersIcon, RefreshIcon } from "../sessions/icons";

function childBadge(status: RlmChild["status"]): { label: string; tone: BadgeTone } {
  switch (status) {
    case "running":
      return { label: "Running", tone: "success" };
    case "idle":
      return { label: "Idle", tone: "neutral" };
    case "done":
      return { label: "Done", tone: "accent" };
    case "error":
      return { label: "Error", tone: "danger" };
  }
}

export function RlmChildrenPanel({ children, onRefresh }: { children: RlmChild[]; onRefresh: () => void }) {
  return (
    <Card variant="raised" padding="lg" style={{ display: "flex", flexDirection: "column", gap: 22 }}>
      <div className="sp-head">
        <div className="sp-headrow">
          <span className="sp-icon sp-icon--dim">
            <LayersIcon size={16} />
          </span>
          <Text variant="label" weight="semibold">
            RLM children
          </Text>
          <Badge tone="neutral">{children.length}</Badge>
        </div>
        <Button variant="ghost" size="sm" icon={<RefreshIcon size={13} />} onClick={onRefresh}>
          Refresh
        </Button>
      </div>

      {children.length === 0 ? (
        <Text variant="body" tone="dim">
          No subagents running.
        </Text>
      ) : (
        <div className="sp-list">
          {children.map((c) => {
            const b = childBadge(c.status);
            return (
              <div key={c.id} className="sp-row">
                <span
                  className={`sp-dot${c.status === "running" ? " sp-dot--running" : c.status === "error" ? " sp-dot--error" : c.status === "done" ? " sp-dot--done" : ""}`}
                />
                <div className="sp-rowmain">
                  <Text variant="label" weight="medium" className="sp-ellipsis">
                    {c.name ?? c.id}
                  </Text>
                  {c.summary ? (
                    <Text variant="micro" tone="dim" className="sp-ellipsis">
                      {c.summary}
                    </Text>
                  ) : null}
                </div>
                <Badge tone={b.tone} dot>
                  {b.label}
                </Badge>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}
