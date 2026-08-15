// InboxView — the agent relay, redesigned (P9) as a message-flow graph:
// YOU → message → peer agent. Each message is a node showing its direction and
// recency; unread incoming messages are green-highlighted with a live edge
// pulse. An agent switcher above selects the peer; the composer sends to it.
//
// Wired to the same real IPC data as the prior rail (listAgents / listInbox /
// sendAgentMessage / markMessageRead + the live event stream) — a
// representation change only. Unread highlight and mark-as-read are preserved.

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, Text } from "../../design";
import { useIpc, useIpcEvent } from "../../ipc/client";
import type { AgentInfo, AgentMessage } from "../../ipc/contract";
import { InboxGraph } from "./InboxGraph";
import "./inbox.css";

const SELF = "self";
const statusRank = { running: 0, idle: 1, saved: 2 } as const;

function peerId(m: AgentMessage) { return m.fromAgentId === SELF ? m.toAgentId : m.fromAgentId; }

export function InboxView() {
  const ipc = useIpc();
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [selected, setSelected] = useState<string>();
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [lastSync, setLastSync] = useState<Date | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [nextAgents, inbox] = await Promise.all([ipc.listAgents(), ipc.listInbox()]);
      setAgents(nextAgents); setMessages(inbox);
      setSelected((old) => old ?? nextAgents[0]?.id ?? (inbox[0] ? peerId(inbox[0]) : undefined));
      setError(undefined);
      setLastSync(new Date());
    } catch (e) { setError(e instanceof Error ? e.message : "Inbox unavailable"); }
    finally { setLoading(false); }
  }, [ipc]);

  useEffect(() => { void refresh(); }, [refresh]);
  useIpcEvent((event) => {
    if (event.type === "agent_list") setAgents(event.agents);
    if (event.type === "agent_status") setAgents((old) => [...old.filter((a) => a.id !== event.agent.id), event.agent]);
    if (event.type === "agent_message") {
      setMessages((old) => old.some((m) => m.id === event.message.id) ? old : [...old, event.message]);
      if (!selected) setSelected(peerId(event.message));
    }
  });

  const sortedAgents = useMemo(() => [...agents].sort((a, b) => statusRank[a.status] - statusRank[b.status]), [agents]);
  const selectedAgent = agents.find((a) => a.id === selected);
  const thread = useMemo(
    () => messages.filter((m) => peerId(m) === selected).sort((a, b) => (a.timestamp ?? "").localeCompare(b.timestamp ?? "")),
    [messages, selected],
  );
  const unreadFor = useCallback(
    (id: string) => messages.filter((m) => peerId(m) === id && m.fromAgentId !== SELF && !m.read).length,
    [messages],
  );
  const totalUnread = messages.filter((m) => m.fromAgentId !== SELF && !m.read).length;

  async function selectAgent(id: string) {
    setSelected(id);
    const unread = messages.filter((m) => peerId(m) === id && m.fromAgentId !== SELF && !m.read);
    if (unread.length) {
      setMessages((old) => old.map((m) => unread.some((u) => u.id === m.id) ? { ...m, read: true } : m));
      await Promise.allSettled(unread.map((m) => ipc.markMessageRead(m.id)));
    }
  }

  async function markMsgRead(messageId: string) {
    const m = messages.find((x) => x.id === messageId);
    if (!m || m.fromAgentId === SELF || m.read) return;
    try { await ipc.markMessageRead(messageId); } catch { /* local mark */ }
    setMessages((old) => old.map((x) => (x.id === messageId ? { ...x, read: true } : x)));
  }

  async function send() {
    const text = draft.trim(); if (!selected || !text || sending) return;
    setSending(true); setError(undefined);
    try {
      await ipc.sendAgentMessage(selected, text);
      setMessages((old) => [...old, { id: `local-${Date.now()}`, fromAgentId: SELF, fromAgentName: "You", toAgentId: selected, toAgentName: selectedAgent?.name, text, timestamp: new Date().toISOString(), read: true }]);
      setDraft("");
    } catch (e) { setError(e instanceof Error ? e.message : "Message failed to send"); }
    finally { setSending(false); }
  }

  const empty = !loading && !error && agents.length === 0 && messages.length === 0;

  return (
    <main className="inbox">
      <header className="inbox__header">
        <div>
          <div className="inbox__eyebrow"><span className="pulse" /> MESSAGE FLOW</div>
          <Text as="h1" variant="display">Inbox</Text>
          <Text tone="muted">Relay traffic as a sender → message → receiver flow. Unread messages stay highlighted.</Text>
        </div>
        <div className="inbox__telemetry">
          <span><b>{agents.filter((a) => a.status === "running").length}</b> live</span>
          <i />
          <span><b>{totalUnread}</b> unread</span>
          <i />
          <span className="inbox__sync">● synchronized</span>
        </div>
      </header>

      {error && (
        <div className="inbox__error" role="alert">
          Relay degraded · {error}
          <Button variant="danger" onClick={() => void refresh()}>Retry</Button>
        </div>
      )}

      {/* Agent switcher (peer selection) */}
      <div className="inbox__chips">
        {sortedAgents.map((agent) => {
          const unread = unreadFor(agent.id);
          return (
            <Button
              key={agent.id}
              variant={selected === agent.id ? "accent-soft" : "ghost"}
              className={`inbox__chip ${selected === agent.id ? "inbox__chip--active" : ""}`}
              onClick={() => void selectAgent(agent.id)}
              title={agent.name ?? agent.id}
            >
              <span className={`inbox__chip__dot${agent.status === "running" ? " inbox__chip__dot--running" : agent.status === "idle" ? " inbox__chip__dot--idle" : ""}`} />
              <span className="inbox__chip__name">{agent.name ?? agent.id}</span>
              {unread > 0 && <span className="inbox__chip__unread">{unread}</span>}
            </Button>
          );
        })}
      </div>

      {/* Message-flow graph + composer */}
      <section className="inbox__console inbox__console--graph">
        <div className="inbox__graphwrap">
          {selected ? (
            <InboxGraph
              peerId={selected}
              peerName={selectedAgent?.name}
              peerStatus={selectedAgent?.status}
              thread={thread}
              onSelectMsg={(mid) => void markMsgRead(mid)}
            />
          ) : null}

          {loading ? (
            <div className="inbox__graphblank">
              <div className="inbox__graphblank__card">
                <b>Opening the relay…</b>
                <span>Resolving agents and messages.</span>
              </div>
            </div>
          ) : error && !agents.length && !messages.length ? (
            <div className="inbox__graphblank">
              <div className="inbox__graphblank__card">
                <b>Relay unavailable</b>
                <span>{error}</span>
                <Button variant="outline" className="inbox__graphblank__retry" onClick={() => void refresh()}>Retry</Button>
              </div>
            </div>
          ) : empty ? (
            <div className="inbox__graphblank">
              <div className="inbox__graphblank__card">
                <b>No relay traffic yet</b>
                <span>The relay shows messages between you and peer agents. Agents appear here when they connect; send a message to open a coordination line. Expect unread messages to stay highlighted until read.</span>
              </div>
            </div>
          ) : !selected ? (
            <div className="inbox__graphblank">
              <div className="inbox__graphblank__card">
                <b>Select an agent</b>
                <span>Choose a peer above to see the message flow and open a coordination line.</span>
              </div>
            </div>
          ) : null}
        </div>

        {/* Composer — send to the selected peer */}
        {selected && (
          <div className="composer">
            <div className="composer__label">
              <span>MESSAGE TO <b>{selectedAgent?.name ?? "AGENT"}</b></span>
              <span>⌘ ↵ TO SEND</span>
            </div>
            <textarea
              aria-label="Message agent"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void send(); } }}
              placeholder="Transmit a clear, bounded instruction…"
            />
            <div className="composer__foot">
              <span>{draft.length}/2000 · relay channel</span>
              <Button size="sm" loading={sending} disabled={!draft.trim()} onClick={() => void send()}>Send message ↗</Button>
            </div>
          </div>
        )}
      </section>

      {/* Thin status footer — a second visual anchor under the (often empty)
          canvas so the view reads as an instrument, not negative space. */}
      <footer className="inbox__foot">
        <span className="inbox__foot__item">
          <span className="inbox__foot__dot" />
          relay {agents.length} agent{agents.length === 1 ? "" : "s"} · {messages.length} message{messages.length === 1 ? "" : "s"}
        </span>
        <span className="inbox__foot__item">
          last sync {lastSync ? lastSync.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "—"}
        </span>
        <span className="inbox__foot__item">
          {selectedAgent ? `peer ${selectedAgent.name ?? selectedAgent.id}` : "no peer selected"}
        </span>
      </footer>
    </main>
  );
}
