// AgentsView — the Agents command center, redesigned (P9) as a node graph of
// the agent fleet: OPERATOR → DAEMON → live agents → RLM children. Live
// connections carry an animated heartbeat; nodes are status-colored instrument
// cards with attach + message actions. Clicking a node opens the coordination
// inspector on the right (unchanged AgentDetail: thread + composer).
//
// Live IPC events (agent_list / agent_status / agent_message) keep the fleet
// and inbox in sync. Degrades gracefully when the daemon is wedged: a plain-
// English error + Retry, skeleton overlay while loading, and an empty-state
// overlay when there's nothing to show. All IPC wiring from the prior console
// is preserved — this is a representation change only.

import { useEffect } from "react";
import { Text, StatusDot, Button, Spinner } from "../../design";
import type { StatusDotState } from "../../design";
import type { ConnectionStatus } from "../../ipc/contract";
import { useAgents } from "./useAgents";
import { AgentDetail } from "./AgentDetail";
import { RefreshIcon } from "./icons";
import { AgentsGraph } from "./AgentsGraph";
import "./agents.css";

function toDot(status: ConnectionStatus): StatusDotState {
  switch (status.kind) {
    case "connecting":
      return "connecting";
    case "connected":
      return "connected";
    case "disconnected":
      return "disconnected";
    case "reconnecting":
      return "reconnecting";
    default:
      return "disconnected";
  }
}

export function AgentsView() {
  const {
    rows,
    selected,
    selectedId,
    setSelectedId,
    thread,
    attachedId,
    attach,
    detach,
    draft,
    setDraft,
    send,
    sending,
    markRead,
    markAllRead,
    markAgentRead,
    unreadByAgent,
    totalUnread,
    loading,
    error,
    refresh,
    runtimeModel,
    connectionStatus,
    connectionModel,
  } = useAgents();

  // Mark the selected agent's thread read as soon as it's viewed.
  useEffect(() => {
    if (selectedId) {
      void markAgentRead(selectedId);
    }
  }, [selectedId, markAgentRead]);

  const running = rows.filter((r) => r.status === "running").length;
  const hasAgents = rows.length > 0;

  return (
    <main className="ag-main">
      {/* Header + fleet telemetry */}
      <header className="ag-header">
        <div>
          <div className="ag-eyebrow">
            <span className="ag-pulse" />
            AGENT FLEET GRAPH
          </div>
          <h1>Agent command center</h1>
          <p>Live topology of the agent fleet — select a node to attach, message, and monitor.</p>
        </div>

        <div className="ag-telemetry">
          <span>
            <b>{running}</b> running
          </span>
          <i />
          <span>
            <b>{rows.length}</b> total
          </span>
          <i />
          <span>
            <b>{totalUnread}</b> unread
          </span>
          <i />
          <StatusDot state={toDot(connectionStatus)} />
          <Text variant="micro" tone="muted" mono uppercase>
            {connectionStatus.kind}
          </Text>
          <Button variant="ghost" size="sm" icon={<RefreshIcon size={13} />} onClick={() => void refresh()}>
            Refresh
          </Button>
        </div>
      </header>

      {/* Connection error banner */}
      {error ? (
        <div className="ag-errorbanner" role="alert">
          <span>⚡</span>
          <span>Agent relay degraded — {error}</span>
          <button className="ag-errorbanner__action" onClick={() => void refresh()} aria-label="Retry">
            Retry
          </button>
        </div>
      ) : null}

      {/* Model context line */}
      <div className="ag-modelbar">
        <span className="ag-modelbar__label">RUNTIME MODEL</span>
        <span className="ag-modelbar__value">{connectionModel?.model ?? "—"}</span>
        <span className="ag-modelbar__provider">{connectionModel?.provider ?? ""}</span>
      </div>

      {/* Console: node graph + inspector */}
      <section className="ag-console ag-console--graph">
        <div className="ag-graphwrap">
          {!loading ? (
            <AgentsGraph
              rows={rows}
              connectionStatus={connectionStatus}
              attachedId={attachedId}
              unreadByAgent={unreadByAgent}
              onSelect={setSelectedId}
              onAttach={attach}
              onMessage={setSelectedId}
            />
          ) : null}

          {/* Degraded states overlayed on the graph canvas */}
          {loading && !hasAgents ? (
            <div className="ag-graphblank">
              <div className="ag-graphblank__card">
                <Spinner size={22} />
                <b>Scanning the relay…</b>
                <span>Resolving daemon, agents, and RLM children.</span>
              </div>
            </div>
          ) : error && !hasAgents ? (
            <div className="ag-graphblank">
              <div className="ag-graphblank__card">
                <b>Fleet unavailable</b>
                <span>{error}</span>
                <button className="ag-graphblank__retry" onClick={() => void refresh()}>
                  Retry
                </button>
              </div>
            </div>
          ) : !loading && !error && !hasAgents ? (
            <div className="ag-graphblank">
              <div className="ag-graphblank__card">
                <b>No agents in range</b>
                <span>The fleet graph shows daemon-backed agents and RLM children. Attach an agent or spawn an RLM child to appear here. Agents appear when they connect; expect live status and message relay once one is present.</span>
              </div>
            </div>
          ) : null}
        </div>

        <div className="ag-inspectorwrap">
          {loading && !selected ? (
            <div className="ag-detail__loading">
              <Spinner size={24} />
              <Text variant="label" tone="dim">
                Scanning the relay…
              </Text>
            </div>
          ) : (
            <AgentDetail
              agent={selected ?? null}
              runtimeModel={runtimeModel}
              attached={attachedId === selected?.id}
              onAttach={() => {
                if (selected) void attach(selected.id);
              }}
              onDetach={() => {
                if (selected) detach(selected.id);
              }}
              thread={thread}
              unreadCount={selectedId ? unreadByAgent(selectedId) : 0}
              draft={draft}
              setDraft={setDraft}
              sending={sending}
              onSend={send}
              onMarkRead={markRead}
              onMarkAllRead={markAllRead}
            />
          )}
        </div>
      </section>

      {/* Footer command hint */}
      <footer className="ag-footer">
        <Text variant="micro" tone="dim" mono>
          RELAY ACTIVE · click a node to attach or message · ⌘K global command
        </Text>
      </footer>
    </main>
  );
}
