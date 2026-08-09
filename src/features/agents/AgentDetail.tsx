// AgentDetail — the right-hand detail pane for the selected agent.
//
// Header (avatar, name, status, kind, model, id) + attach/detach action,
// a telemetry grid (kind, session, parent, summary, duration), then the
// coordination thread (InboxThread) with the AgentComposer at the foot.
// When nothing is selected, a standby prompt invites the user to pick an agent.

import { Button } from "../../design";
import type { ReactNode } from "react";
import { AttachIcon, DetachIcon, LayersIcon, PlugIcon, ClockIcon } from "./icons";
import { initials } from "../../features/sessions/format";
import type { AgentMessage } from "../../ipc/contract";
import type { AgentRow } from "./useAgents";
import { InboxThread } from "./InboxThread";
import { AgentComposer } from "./AgentComposer";
import "./agents.css";

interface AgentDetailProps {
  agent: AgentRow | null;
  runtimeModel?: string;
  attached: boolean;
  onAttach: () => void;
  onDetach: () => void;
  thread: AgentMessage[];
  unreadCount: number;
  draft: string;
  setDraft: (v: string) => void;
  sending: boolean;
  onSend: () => void;
  onMarkRead: (id: string) => void;
  onMarkAllRead: () => void;
}

export function AgentDetail({
  agent,
  runtimeModel,
  attached,
  onAttach,
  onDetach,
  thread,
  unreadCount,
  draft,
  setDraft,
  sending,
  onSend,
  onMarkRead,
  onMarkAllRead,
}: AgentDetailProps) {
  const model = agent?.model ?? runtimeModel;

  return (
    <aside className="ag-detail">
      {!agent ? (
        <div className="ag-detail__standby">
          <div className="ag-glyph">◈</div>
          <h2>No agent selected</h2>
          <p>Choose an agent from the rail to inspect its status, telemetry, and coordination thread.</p>
        </div>
      ) : (
        <>
          {/* Head */}
          <div className="ag-detail__head">
            <div className="ag-detail__avatar">{initials(agent.name ?? agent.id)}</div>
            <div className="ag-detail__headmeta">
              <b>{agent.name ?? agent.id}</b>
              <span>
                <i className={`ag-status ag-status--${agent.status}`} />
                {statusLabel(agent.status)} · {agent.kind === "daemon" ? "daemon-backed" : "RLM subagent"}
              </span>
              <small>
                <i className="ag-kind" />
                {agent.kind === "daemon" ? "Daemon agent" : "RLM child"}
              </small>
            </div>
            <div className="ag-detail__id">AGENT / {(agent.id ?? "").slice(0, 8).toUpperCase()}</div>
          </div>

          {/* Telemetry grid */}
          <div className="ag-detail__body">
            <Row icon={<PlugIcon size={14} />} label="Kind" value={agent.kind === "daemon" ? "Daemon-backed agent" : "RLM child subagent"} />
            <Row icon={<ClockIcon size={14} />} label="Status" value={statusLabel(agent.status)} />
            <Row icon={<LayersIcon size={14} />} label="Runtime model" value={model ?? "—"} />
            {agent.sessionId ? <Row icon={<ClockIcon size={14} />} label="Session" value={agent.sessionId} /> : null}
            {agent.parentId ? <Row icon={<LayersIcon size={14} />} label="Parent" value={agent.parentId} /> : null}
            <Row icon={<ClockIcon size={14} />} label="Agent id" value={agent.id} mono />
            {agent.summary ? <Row icon={<LayersIcon size={14} />} label="Summary" value={agent.summary} /> : null}
          </div>

          {/* Actions */}
          <div className="ag-detail__actions">
            {attached ? (
              <Button variant="outline" size="sm" icon={<DetachIcon size={13} />} onClick={onDetach}>
                Detach
              </Button>
            ) : (
              <Button variant="primary" size="sm" icon={<AttachIcon size={13} />} onClick={onAttach}>
                Attach
              </Button>
            )}
          </div>
        </>
      )}

      {/* Coordination thread + composer (always present so the relay is usable) */}
      <div className="ag-detail__thread">
        <InboxThread
          agent={agent}
          messages={thread}
          unreadCount={unreadCount}
          onMarkRead={onMarkRead}
          onMarkAllRead={onMarkAllRead}
        />
        <AgentComposer
          agent={agent}
          draft={draft}
          setDraft={setDraft}
          sending={sending}
          onSend={onSend}
        />
      </div>
    </aside>
  );
}

function Row({ icon, label, value, mono }: { icon: ReactNode; label: string; value: string; mono?: boolean }) {
  // Definition-list shape: label above value so long values get the full rail
  // width (the old 3-column icon|label|value row shredded words via break-all).
  // `title` keeps a full opaque id readable on hover without breaking it apart.
  return (
    <div className="ag-detail__row">
      <span className="ag-detail__rowhead">
        <span className="ag-detail__rowicon">{icon}</span>
        <label>{label}</label>
      </span>
      <span className={mono ? "ag-detail__rowvalue ag-detail__rowvalue--mono" : "ag-detail__rowvalue"} title={value}>
        {value}
      </span>
    </div>
  );
}

function statusLabel(status: AgentRow["status"]): string {
  switch (status) {
    case "running":
      return "Running";
    case "idle":
      return "Idle";
    case "saved":
      return "Saved";
    case "done":
      return "Done";
    case "error":
      return "Error";
    default:
      return status;
  }
}
