// useAgents — state engine for the Agents command center.
//
// Owns: daemon-backed agents (listAgents) + RLM children (getRlmChildren),
// the inbox (listInbox), attach/detach, agent-to-agent messaging (sendAgentMessage),
// mark-as-read, and the live event stream (agent_list / agent_status / agent_message).
//
// The daemon-backed list and the RLM-child list are tracked as separate slices
// so event-driven updates (agent_list / agent_status only carry AgentInfo) can
// patch one slice without clobbering the other. They are merged into a single
// display list in a memo.
//
// Graceful degradation: every IPC call is wrapped in try/catch. When the
// named-pipe daemon is wedged (this environment) the view shows a plain-English
// error + retry rather than crashing. The MockIpcClient (browser preview)
// surfaces empty lists — never faked data.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useIpc, useIpcEvent, useConnectionState } from "../../ipc/client";
import type { AgentInfo, AgentMessage, AgentMessageReceipt, AgentSessionState, AgentWatchEvent, RlmChild } from "../../ipc/contract";
import { useUnreadRefresh } from "../../ipc/unread";

/** Where an agent process originates. */
export type AgentKind = "daemon" | "rlm";
/** Unified status, normalized from both AgentInfo ("saved") and RlmChild ("done"|"error"). */
export type AgentStatus = "running" | "idle" | "saved" | "done" | "error";

export interface AgentRow {
  id: string;
  name?: string;
  kind: AgentKind;
  status: AgentStatus;
  summary?: string;
  sessionId?: string;
  parentId?: string;
  model?: string;
}

/** The local client's own agent id. Mirrors the convention used by InboxView. */
export const SELF = "self";

function toAgentRow(a: AgentInfo): AgentRow {
  const status: AgentStatus = a.status === "saved" ? "saved" : a.status;
  return { id: a.id, name: a.name, kind: "daemon", status, sessionId: a.sessionId };
}

function childToAgentRow(c: RlmChild): AgentRow {
  return { id: c.id, name: c.name, kind: "rlm", status: c.status, summary: c.summary, parentId: c.parentId, sessionId: c.sessionId };
}

export function useAgents() {
  const ipc = useIpc();
  const conn = useConnectionState();
  const [daemonAgents, setDaemonAgents] = useState<AgentInfo[]>([]);
  const [rlmChildren, setRlmChildren] = useState<RlmChild[]>([]);
  const [inbox, setInbox] = useState<AgentMessage[]>([]);
  const [selectedId, setSelectedId] = useState<string>();
  const [selectedAgentState, setSelectedAgentState] = useState<AgentSessionState>();
  const [attachedIds, setAttachedIds] = useState<string[]>([]);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [deliveryReceipt, setDeliveryReceipt] = useState<AgentMessageReceipt>();
  const [error, setError] = useState<string>();

  const runtimeModel = conn.model?.model;
  const unreadRefresh = useUnreadRefresh();

  const rows = useMemo<AgentRow[]>(
    () => [...daemonAgents.map(toAgentRow), ...rlmChildren.map(childToAgentRow)],
    [daemonAgents, rlmChildren],
  );

  const selected = rows.find((r) => r.id === selectedId) ?? null;

  // Threads are the inbox messages whose peer is the selected agent.
  const thread = useMemo(() => {
    if (!selectedId) return [];
    return inbox.filter((m) => peerOf(m) === selectedId).sort(byTimestamp);
  }, [inbox, selectedId]);

  const unreadByAgent = useCallback(
    (id: string) => inbox.filter((m) => m.toAgentId === id && incoming(m)).length,
    [inbox],
  );
  const totalUnread = useMemo(() => inbox.filter((m) => incoming(m)).length, [inbox]);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(undefined);
    try {
      const [daemon, rlm, mb] = await Promise.all([ipc.listAgents(), ipc.getRlmChildren(), ipc.listInbox()]);
      setDaemonAgents(daemon ?? []);
      setRlmChildren(rlm ?? []);
      setInbox(mb ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Agent relay unavailable");
    } finally {
      setLoading(false);
    }
  }, [ipc]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Auto-select the first available agent when the selection is empty.
  useEffect(() => {
    setSelectedId((cur) => {
      if (cur && rows.some((r) => r.id === cur)) return cur;
      return rows[0]?.id;
    });
  }, [rows]);

  useEffect(() => {
    setDeliveryReceipt(undefined);
  }, [selectedId]);

  useEffect(() => {
    let mounted = true;
    // Clear the previous child immediately. Otherwise a slow watcher request
    // can leave the old agent's transcript visible while the new node is
    // already selected.
    setSelectedAgentState(undefined);
    if (!selectedId) {
      return () => { mounted = false; };
    }
    ipc.getAgentState(selectedId).then((next) => {
      if (mounted) setSelectedAgentState(next);
    }).catch(() => {
      if (mounted) setSelectedAgentState(undefined);
    });
    return () => { mounted = false; };
  }, [ipc, selectedId]);

  const applyWatchEvent = useCallback((event: AgentWatchEvent) => {
    if (event.kind === "attached") {
      setAttachedIds((current) => current.includes(event.childId) ? current : [...current, event.childId]);
      setSelectedAgentState((current) => current === undefined || current.id === event.childId ? event.state : current);
      return;
    }
    if (event.kind === "detached") {
      setAttachedIds((current) => current.filter((id) => id !== event.childId));
      return;
    }
    setSelectedAgentState((current) => current?.id === event.childId ? event.state : current);
    if (event.kind === "status") {
      setRlmChildren((old) => old.map((child) => child.id === event.childId ? { ...child, status: event.status } : child));
    }
  }, []);

  // ---- Live event stream ----
  useIpcEvent((event) => {
    if (event.type === "agent_list") {
      setDaemonAgents(event.agents);
    } else if (event.type === "agent_status") {
      setDaemonAgents((old) =>
        old.some((a) => a.id === event.agent.id)
          ? old.map((a) => (a.id === event.agent.id ? event.agent : a))
          : [...old, event.agent],
      );
    } else if (event.type === "agent_message") {
      setInbox((old) => (old.some((m) => m.id === event.message.id) ? old : [...old, event.message]));
    } else if (event.type === "agent_watch") {
      applyWatchEvent(event.event);
    }
  });

  // ---- Attach / detach ----
  const attach = useCallback(
    async (id: string) => {
      if (!rows.some((r) => r.id === id)) return;
      setError(undefined);
      try {
        await ipc.attachAgent(id);
        setSelectedId(id);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Attach failed");
      }
    },
    [ipc, rows],
  );

  const detach = useCallback(async (id: string) => {
    setError(undefined);
    try {
      await ipc.detachAgent(id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Detach failed");
    }
  }, [ipc]);

  // ---- Messaging ----
  const send = useCallback(async () => {
    const text = draft.trim();
    if (!selectedId || !text || sending) return;
    setSending(true);
    setError(undefined);
    try {
      const receipt = await ipc.sendAgentMessage(selectedId, text);
      setDeliveryReceipt(receipt);
      // Refresh the live session projection after delivery so the inspector
      // does not remain on the pre-message transcript. The inbox echo below
      // keeps the coordination thread responsive while the child processes it.
      try {
        setSelectedAgentState(await ipc.getAgentState(selectedId));
      } catch {
        // A queued message may temporarily outlive the child watcher; retain
        // the last readable state and let the next selection refresh retry.
      }
      // Optimistic echo so the relay feels responsive.
      const peer = rows.find((r) => r.id === selectedId);
      setInbox((old) => [
        ...old,
        {
          id: `local-${receipt.id}`,
          fromAgentId: SELF,
          fromAgentName: "You",
          toAgentId: selectedId,
          toAgentName: peer?.name,
          text,
          timestamp: new Date().toISOString(),
          read: true,
        },
      ]);
      setDraft("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Message failed to send");
    } finally {
      setSending(false);
    }
  }, [ipc, draft, selectedId, sending, rows]);

  // ---- Mark read ----
  const markRead = useCallback(
    async (messageId: string) => {
      try {
        await ipc.markMessageRead(messageId);
      } catch {
        // fall through to local mark
      }
      setInbox((old) => old.map((m) => (m.id === messageId ? { ...m, read: true } : m)));
      unreadRefresh?.();
    },
    [ipc],
  );

  const markAllRead = useCallback(async () => {
    const toMark = thread.filter((m) => incoming(m));
    await Promise.allSettled(toMark.map((m) => ipc.markMessageRead(m.id)));
    setInbox((old) =>
      old.map((m) => (toMark.some((t) => t.id === m.id) ? { ...m, read: true } : m)),
    );
    unreadRefresh?.();
  }, [thread, ipc]);

  // Mark every incoming unread message addressed to a given agent as read.
  const markAgentRead = useCallback(
    async (id: string) => {
      const toMark = inbox.filter((m) => m.toAgentId === id && incoming(m));
      await Promise.allSettled(toMark.map((m) => ipc.markMessageRead(m.id)));
      setInbox((old) =>
        old.map((m) => (toMark.some((t) => t.id === m.id) ? { ...m, read: true } : m)),
      );
      unreadRefresh?.();
    },
    [inbox, ipc],
  );

  return {
    rows,
    selected,
    selectedId,
    selectedAgentState,
    setSelectedId,
    thread,
    inbox,
    attachedIds,
    attach,
    detach,
    deliveryReceipt,
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
    connectionStatus: conn.status,
    connectionModel: conn.model,
  };
}

function peerOf(m: AgentMessage): string {
  return m.fromAgentId === SELF ? m.toAgentId : m.fromAgentId;
}
function incoming(m: AgentMessage): boolean {
  return m.fromAgentId !== SELF && m.read !== true;
}
function byTimestamp(a: AgentMessage, b: AgentMessage): number {
  return (a.timestamp ?? "").localeCompare(b.timestamp ?? "");
}
