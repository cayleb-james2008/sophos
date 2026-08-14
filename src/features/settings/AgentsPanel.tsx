// AgentsPanel — attached agents card.

import { Text, Card, Badge, Button, type BadgeTone } from "../../design";
import type { AgentInfo } from "../../ipc/contract";
import { PlugIcon, RefreshIcon } from "../sessions/icons";

function agentBadge(status: AgentInfo["status"]): { label: string; tone: BadgeTone } {
  switch (status) {
    case "running":
      return { label: "Running", tone: "success" };
    case "idle":
      return { label: "Idle", tone: "neutral" };
    case "saved":
      return { label: "Saved", tone: "accent" };
  }
}

export function AgentsPanel({
  agents,
  onAttach,
  onRefresh,
}: {
  agents: AgentInfo[];
  onAttach: (id: string) => void;
  onRefresh: () => void;
}) {
  return (
    <Card variant="raised" padding="lg" style={{ display: "flex", flexDirection: "column", gap: 22 }}>
      <div className="sp-head">
        <div className="sp-headrow">
          <span className="sp-icon sp-icon--dim">
            <PlugIcon size={16} />
          </span>
          <Text variant="label" weight="semibold">
            Attached agents
          </Text>
          <Badge tone="neutral">{agents.length}</Badge>
        </div>
        <Button variant="ghost" size="sm" icon={<RefreshIcon size={13} />} onClick={onRefresh}>
          Refresh
        </Button>
      </div>

      {agents.length === 0 ? (
        <Text variant="body" tone="dim">
          No agents attached. Attach an agent to relay work to it.
        </Text>
      ) : (
        <div className="sp-list">
          {agents.map((a) => {
            const b = agentBadge(a.status);
            return (
              <div key={a.id} className="sp-row">
                <span
                  className={`sp-dot${a.status === "running" ? " sp-dot--running" : a.status === "saved" ? " sp-dot--saved" : ""}`}
                />
                <div className="sp-rowmain">
                  <Text variant="label" weight="medium" className="sp-ellipsis">
                    {a.name ?? a.id}
                  </Text>
                  {a.sessionId ? (
                    <Text variant="micro" tone="dim" mono>
                      session {a.sessionId}
                    </Text>
                  ) : null}
                </div>
                <Badge tone={b.tone} dot>
                  {b.label}
                </Badge>
                <Button variant="accent-soft" size="sm" icon={<PlugIcon size={12} />} onClick={() => onAttach(a.id)}>
                  Attach
                </Button>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}
