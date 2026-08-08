// AgentRail — the left rail of the Agents command center.
//
// Lists daemon-backed agents and RLM children in grouped sections, each row
// showing identity (initials avatar + status dot), kind, run summary, the
// runtime model, an unread-message badge, and an attach/detach toggle.
// Skeleton + empty + error states degrade gracefully when the daemon wedges.

import type { ReactNode } from "react";
import { initials } from "../../features/sessions/format";
import { AttachIcon, DetachIcon } from "./icons";
import type { AgentRow } from "./useAgents";
import "./agents.css";

interface AgentRailProps {
  agents: AgentRow[];
  selectedId?: string;
  loading: boolean;
  error?: string;
  attachedId?: string;
  runtimeModel?: string;
  onAttach: (id: string) => void;
  onDetach: (id: string) => void;
  onSelect: (id: string) => void;
  unreadByAgent: (id: string) => number;
  onRetry: () => void;
}

export function AgentRail({
  agents,
  selectedId,
  loading,
  error,
  attachedId,
  runtimeModel,
  onAttach,
  onDetach,
  onSelect,
  unreadByAgent,
  onRetry,
}: AgentRailProps) {
  const daemon = agents.filter((a) => a.kind === "daemon");
  const rlm = agents.filter((a) => a.kind === "rlm");

  return (
    <aside className="ag-rail">
      <div className="ag-railhead">
        <span>AGENT FLEET</span>
        <span>{agents.length.toString().padStart(2, "0")}</span>
      </div>

      <div className="ag-railbody">
        {error ? (
          <div className="ag-railerror" role="alert">
            <span className="ag-railerror__icon">⚡</span>
            <span className="ag-railerror__msg">{error}</span>
            <button className="ag-railerror__retry" onClick={() => onRetry()} aria-label="Retry">
              Retry
            </button>
          </div>
        ) : null}

        {loading ? (
          <SkeletonRail />
        ) : agents.length === 0 ? (
          <div className="ag-emptyrail">
            <div className="ag-radar">⌁</div>
            <b>No agents in range</b>
            <p>Attach a daemon-backed agent or spawn an RLM child to appear here.</p>
          </div>
        ) : (
          <>
            {daemon.length > 0 ? (
              <Group label="Daemon" count={daemon.length}>
                {daemon.map((a) => (
                  <AgentRowItem
                    key={a.id}
                    agent={a}
                    selected={a.id === selectedId}
                    attached={attachedId === a.id}
                    unread={unreadByAgent(a.id)}
                    runtimeModel={runtimeModel}
                    onAttach={onAttach}
                    onDetach={onDetach}
                    onSelect={onSelect}
                  />
                ))}
              </Group>
            ) : null}
            {rlm.length > 0 ? (
              <Group label="RLM children" count={rlm.length}>
                {rlm.map((a) => (
                  <AgentRowItem
                    key={a.id}
                    agent={a}
                    selected={a.id === selectedId}
                    attached={attachedId === a.id}
                    unread={unreadByAgent(a.id)}
                    runtimeModel={runtimeModel}
                    onAttach={onAttach}
                    onDetach={onDetach}
                    onSelect={onSelect}
                  />
                ))}
              </Group>
            ) : null}
          </>
        )}
      </div>

      <div className="ag-railfoot">
        <span>
          <i className="ag-status ag-status--running" /> running
        </span>
        <span>
          <i className="ag-status ag-status--idle" /> idle
        </span>
        <span>
          <i className="ag-status ag-status--saved" /> saved
        </span>
        <span>
          <i className="ag-status ag-status--done" /> done
        </span>
        <span>
          <i className="ag-status ag-status--error" /> error
        </span>
      </div>
    </aside>
  );
}

function Group({ label, count, children }: { label: string; count: number; children: ReactNode }) {
  return (
    <div className="ag-group">
      <div className="ag-grouphead">
        <span>{label}</span>
        <span>{count}</span>
      </div>
      {children}
    </div>
  );
}

function SkeletonRail() {
  return (
    <>
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="ag-agent ag-agent--skeleton" />
      ))}
    </>
  );
}

interface AgentRowItemProps {
  agent: AgentRow;
  selected: boolean;
  attached: boolean;
  unread: number;
  runtimeModel?: string;
  onAttach: (id: string) => void;
  onDetach: (id: string) => void;
  onSelect: (id: string) => void;
}

function AgentRowItem({ agent, selected, attached, unread, runtimeModel, onAttach, onDetach, onSelect }: AgentRowItemProps) {
  const idShort = agent.id.slice(0, 8).toUpperCase();
  const summary = agent.summary ?? (agent.sessionId ? `session ${agent.sessionId.slice(0, 8)}` : idShort);
  const model = agent.model ?? runtimeModel;

  return (
    <button
      className={`ag-agent ${selected ? "ag-agent--selected" : ""}`}
      onClick={() => onSelect(agent.id)}
      aria-current={selected ? "page" : undefined}
      aria-label={agent.name ?? agent.id}
    >
      <span className="ag-agent__edge" />
      <span className="ag-agent__avatar">
        {initials(agent.name ?? agent.id)}
        <i className={`ag-status ag-status--${agent.status}`} />
      </span>

      <span className="ag-agent__meta">
        <b title={agent.name ?? agent.id}>{agent.name ?? agent.id}</b>
        <small title={summary} className="ag-agent__summary">
          {summary}
        </small>
        {model ? <small className="ag-agent__model">{model}</small> : null}
      </span>

      <i className={`ag-kind ag-kind--${agent.kind}`} title={agent.kind === "daemon" ? "Daemon-backed agent" : "RLM child subagent"}>
        {agent.kind === "daemon" ? "Daemon" : "RLM"}
      </i>

      {unread > 0 ? (
        <span className="ag-unread" title={`${unread} unread`}>
          {unread}
        </span>
      ) : null}

      <span className="ag-agent__actions" onClick={(e) => e.stopPropagation()}>
        {attached ? (
          <button className="ag-act" title="Stop monitoring" aria-label="Detach" onClick={() => onDetach(agent.id)}>
            <DetachIcon size={12} />
          </button>
        ) : (
          <button
            className="ag-act ag-act--accent"
            title="Attach to relay"
            aria-label="Attach"
            onClick={() => onAttach(agent.id)}
          >
            <AttachIcon size={12} />
          </button>
        )}
      </span>
    </button>
  );
}
