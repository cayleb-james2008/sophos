// InboxThread — the message thread between the local client (SELF) and the
// selected agent, rendered inside the detail pane. Incoming unread messages
// are marked read on view and can be marked read individually.

import type { AgentMessage } from "../../ipc/contract";
import { Button, IconButton } from "../../design";
import { SELF, type AgentRow } from "./useAgents";
import { formatDate } from "../../features/sessions/format";
import { CheckIcon } from "./icons";

interface InboxThreadProps {
  agent: AgentRow | null;
  messages: AgentMessage[];
  unreadCount: number;
  onMarkRead: (id: string) => void;
  onMarkAllRead: () => void;
}

export function InboxThread({ agent, messages, unreadCount, onMarkRead, onMarkAllRead }: InboxThreadProps) {
  const target = agent?.name ?? "Agent";

  return (
    <div className="ag-thread">
      <div className="ag-thread__head">
        <div className="ag-detail__avatar ag-detail__avatar--large">
          {agent ? initials(agent.name ?? agent.id) : "◈"}
        </div>
        <div className="ag-thread__meta">
          <b>{agent ? target : "No agent selected"}</b>
          <span>
            <i className={agent ? `ag-status ag-status--${agent.status}` : ""} />
            {agent ? `${agent.status} · ${agent.kind} channel` : "select an agent to begin"}
          </span>
        </div>
        <div className="ag-thread__id">THREAD / {(agent?.id ?? "").slice(0, 8).toUpperCase()}</div>
      </div>

      <div className="ag-thread__messages">
        {!agent ? (
          <div className="ag-thread__welcome">
            <div className="ag-glyph">◈</div>
            <h2>Agent relay standing by</h2>
            <p>Select an agent from the rail to inspect its thread and coordinate work. Incoming messages surface instantly with unread priority.</p>
            <span>WAITING FOR SIGNAL</span>
          </div>
        ) : messages.length === 0 ? (
          <div className="ag-thread__empty">
            <div className="ag-glyph">↗</div>
            <h2>Open a coordination line</h2>
            <p>Send a precise brief, request an update, or hand off a bounded task. Replies arrive here in real time.</p>
          </div>
        ) : (
          messages.map((m) => {
            const outgoing = m.fromAgentId === SELF;
            return (
              <article className={`ag-message ${outgoing ? "ag-message--out" : ""}`} key={m.id}>
                <div className="ag-message__label">
                  <b>{outgoing ? "YOU" : m.fromAgentName ?? target}</b>
                  <span>
                    {m.timestamp ? formatDate(m.timestamp) : ""} {outgoing ? "" : !m.read ? "· UNREAD" : "· READ"}
                  </span>
                  {!outgoing && !m.read ? (
                    <IconButton
                      className="ag-message__readbtn"
                      title="Mark message as read"
                      size="sm"
                      onClick={() => onMarkRead(m.id)}
                    >
                      <CheckIcon size={11} />
                    </IconButton>
                  ) : null}
                </div>
                <div className="ag-message__bubble">{m.text}</div>
              </article>
            );
          })
        )}
      </div>

      {agent && unreadCount > 0 ? (
        <div className="ag-thread__markall">
          <Button size="sm" variant="ghost" icon={<CheckIcon size={12} />} onClick={() => onMarkAllRead()}>
            Mark all read ({unreadCount})
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function initials(name?: string): string {
  const s = (name ?? "").trim();
  if (!s) return "◈";
  return s
    .split(/\s+/)
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}
