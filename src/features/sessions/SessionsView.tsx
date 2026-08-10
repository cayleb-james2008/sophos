// SessionsView — the session command center, redesigned (P9) as a node graph:
// session nodes carry a context-usage ring and edges flow to each session's
// goals and RLM children. Resume / Fork live on the node; clicking a session
// opens the detail inspector on the right (unchanged SessionDetail).
//
// Wired to the IPC client with graceful degradation when the daemon is
// unreachable — same data logic as the prior rail, a representation change only.

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, Text, Spinner } from "../../design";
import { useIpc, useConnectionState } from "../../ipc/client";
import type { SessionInfo, ContextStats, Goal, RlmChild } from "../../ipc/contract";
import { SessionDetail } from "./SessionDetail";
import { PlusIcon, RefreshIcon } from "./icons";
import { relativeTime } from "./format";
import { SessionsGraph } from "./SessionsGraph";
import { SessionTree } from "./SessionTree";
import { TreeIcon } from "./icons";
import "./sessions.css";

/** Per-session enrichment: context + goals + rlmChildren, loaded lazily. */
type SessionEnrichment = {
  context?: ContextStats;
  goals?: Goal[];
  rlmChildren?: RlmChild[];
};

export function SessionsView({
  onNewSession,
  initialFilter,
  initialSelectedId,
}: {
  onNewSession?: () => void;
  /** Optional pre-filter (e.g. from the ⌘K "Find session" command) — seeds the name filter. */
  initialFilter?: string;
  /** Optional session id to select on mount (e.g. the session the user picked in the palette). */
  initialSelectedId?: string;
}) {
  const ipc = useIpc();
  const conn = useConnectionState();
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [enrichment, setEnrichment] = useState<Record<string, SessionEnrichment>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>();
  const [selectedId, setSelectedId] = useState<string | null>(initialSelectedId ?? null);
  const [actionError, setActionError] = useState<string | undefined>();
  const [viewMode, setViewMode] = useState<"graph" | "tree">("graph");
  // P5: session list filter — narrows the graph by name (case-insensitive
  // substring) and/or status, in real time. Empty filter shows all sessions.
  const [filter, setFilter] = useState(initialFilter ?? "");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "saved" | "idle">("all");
  const handleNew = onNewSession ?? (() => {});

  const daemonDown = conn.status.kind === "disconnected";

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(undefined);
    setActionError(undefined);
    try {
      const list = await ipc.listSessions();
      setSessions(list);
      const ids = list.map((s) => s.id);
      setSelectedId((cur) => (cur && ids.includes(cur) ? cur : list[0]?.id ?? null));
      const next: Record<string, SessionEnrichment> = {};
      await Promise.all(
        ids.map(async (id) => {
          if (id === conn.activeSessionId) {
            const [ctx, rlm] = await Promise.all([
              ipc.getContextStats().catch(() => undefined),
              ipc.getRlmChildren().catch(() => undefined),
            ]);
            next[id] = {
              context: ctx,
              goals: conn.goals,
              rlmChildren: rlm ?? conn.rlmChildren,
            };
          } else {
            next[id] = {};
          }
        }),
      );
      setEnrichment(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Session list unavailable");
      setSessions([]);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ipc, conn.activeSessionId, conn.goals, conn.rlmChildren]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Keep the active session's enrichment in sync with live connection state.
  useEffect(() => {
    if (!conn.activeSessionId) return;
    const active = conn.activeSessionId;
    setEnrichment((prev) => ({
      ...prev,
      [active]: {
        ...prev[active],
        goals: conn.goals,
        rlmChildren: conn.rlmChildren ?? prev[active]?.rlmChildren,
      },
    }));
  }, [conn.activeSessionId, conn.goals, conn.rlmChildren]);

  // P5: apply the name + status filter to the session list. When both are
  // empty/unset the list is unchanged (all sessions shown).
  const filteredSessions = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q && statusFilter === "all") return sessions;
    return sessions.filter((s) => {
      const title = (s.title ?? s.id).toLowerCase();
      const matchesName = !q || title.includes(q);
      const matchesStatus = statusFilter === "all" || (s.status ?? "idle") === statusFilter;
      return matchesName && matchesStatus;
    });
  }, [sessions, filter, statusFilter]);

  const selected = filteredSessions.find((s) => s.id === selectedId) ?? filteredSessions[0] ?? null;

  const activeCount = sessions.filter((s) => s.status === "active").length;
  const savedCount = sessions.filter((s) => s.status === "saved").length;
  const lastActivity = useMemo(() => {
    const times = sessions.map((s) => s.updatedAt).filter(Boolean) as string[];
    if (!times.length) return "—";
    return relativeTime(times.sort().reverse()[0]);
  }, [sessions]);

  const act = async (fn: () => Promise<void>, label: string) => {
    setActionError(undefined);
    try {
      await fn();
      await refresh();
    } catch (e) {
      setActionError(`${label} failed: ${e instanceof Error ? e.message : "unreachable"}`);
    }
  };

  const empty = !loading && !error && sessions.length === 0;
  // Filter active but nothing matched — distinct from a truly empty fleet.
  const filteredEmpty = !loading && !error && sessions.length > 0 && filteredSessions.length === 0;

  return (
    <main className="sessions">
      {/* One restrained header band: heading + hairline-separated telemetry.
          No animated pulse, no boxed telemetry card — the graph below is the
          primary object (S3). */}
      <header className="sessions__header">
        <div className="sessions__heading">
          <div className="sessions__eyebrow">SESSION GRAPH</div>
          <h1>Session command center</h1>
          <p>Live topology of sessions, their goals, and subagents — select a session node to inspect.</p>
        </div>
        <div className="sessions__headband">
          <div className="sessions__telemetry">
            <span>
              <b>{activeCount}</b> active
            </span>
            <i />
            <span>
              <b>{savedCount}</b> saved
            </span>
            <i />
            <span className={daemonDown ? "sessions__sync--down" : "sessions__sync"}>
              {daemonDown ? "daemon offline" : `last activity ${lastActivity}`}
            </span>
          </div>
        </div>
      </header>

      {/* Daemon-down banner */}
      {daemonDown && (
        <div className="sessions__daemon-down" role="alert">
          <div className="sessions__daemon-icon">⏚</div>
          <div className="sessions__daemon-body">
            <Text variant="label" tone="warning">
              Daemon unreachable
            </Text>
            <Text variant="micro" tone="dim">
              {conn.status.kind === "disconnected" && conn.status.reason
                ? conn.status.reason
                : "The agent daemon is not responding. Session actions may fail until it reconnects."}
            </Text>
          </div>
          <Button variant="outline" size="sm" icon={<RefreshIcon size={13} />} onClick={() => void refresh()}>
            Retry connection
          </Button>
        </div>
      )}

      {/* Per-action error toast */}
      {actionError && (
        <div className="sessions__actionerror" role="alert">
          <Text variant="micro" tone="warning">
            {actionError}
          </Text>
          <button className="sessions__dismiss" onClick={() => setActionError(undefined)}>
            ✕
          </button>
        </div>
      )}

        {/* Toolbar: view switch + filter + actions on one restrained row */}
      <div className="sessions__toolbar">
        {/* View switch: graph vs context tree */}
        <div className="sessions__modeswitch" role="tablist" aria-label="Session view">
          <button
            role="tab"
            aria-selected={viewMode === "graph"}
            className={`sessions__modeswitch-btn${viewMode === "graph" ? " sessions__modeswitch-btn--active" : ""}`}
            onClick={() => setViewMode("graph")}
          >
            Graph
          </button>
          <button
            role="tab"
            aria-selected={viewMode === "tree"}
            className={`sessions__modeswitch-btn${viewMode === "tree" ? " sessions__modeswitch-btn--active" : ""}`}
            onClick={() => setViewMode("tree")}
          >
            <TreeIcon size={12} /> Tree
          </button>
        </div>

        {/* P5: session filter — name search + status select, real-time. */}
        <div className="sessions__filter">
          <div className="sessions__search">
            <span className="sessions__search-icon" aria-hidden>
              ⌕
            </span>
            <input
              type="text"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter sessions…"
              aria-label="Filter sessions by name"
              className="sessions__search-input"
            />
            {filter ? (
              <button
                type="button"
                className="sessions__search-clear"
                onClick={() => setFilter("")}
                aria-label="Clear session filter"
                title="Clear filter"
              >
                ✕
              </button>
            ) : null}
          </div>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as "all" | "active" | "saved" | "idle")}
            aria-label="Filter sessions by status"
            className="sessions__status-select"
          >
            <option value="all">All</option>
            <option value="active">Active</option>
            <option value="saved">Saved</option>
            <option value="idle">Idle</option>
          </select>
        </div>

        {/* Actions */}
        <div className="sessions__actions">
          <Button variant="ghost" icon={<RefreshIcon size={14} />} onClick={() => void refresh()} loading={loading}>
            Refresh
          </Button>
          <Button variant="primary" icon={<PlusIcon size={14} />} onClick={handleNew} disabled={daemonDown}>
            New session
          </Button>
        </div>
      </div>

      {/* Console: node graph + inspector */}
      <section className="sessions__console sessions__console--graph">
        <div className="sessions__graphwrap">
          {viewMode === "graph" ? (
            <>
              <SessionsGraph
                sessions={filteredSessions}
                enrichment={enrichment}
                activeSessionId={conn.activeSessionId}
                daemonDown={daemonDown}
                onSelect={(id) => setSelectedId(id)}
                onResume={(id) => void act(() => ipc.resumeSession(id), "Resume")}
                onFork={(id) => void act(() => ipc.forkSession(id), "Fork")}
              />

              {/* Degraded states overlayed on the graph canvas */}
              {loading ? (
                <div className="sessions__graphblank">
                  <div className="sessions__graphblank__card">
                    <Spinner size={22} />
                    <b>Loading session fleet…</b>
                    <span>Resolving sessions, goals, and subagents.</span>
                  </div>
                </div>
              ) : error ? (
                <div className="sessions__graphblank">
                  <div className="sessions__graphblank__card">
                    <b>Sessions unavailable</b>
                    <span>{error}</span>
                    <button className="sessions__graphblank__link" onClick={() => void refresh()}>
                      Try again
                    </button>
                  </div>
                </div>
              ) : filteredEmpty ? (
                <div className="sessions__graphblank">
                  <div className="sessions__graphblank__card">
                    <b>No sessions match your filter</b>
                    <span>Try a different name or status.</span>
                    <button className="sessions__graphblank__link" onClick={() => { setFilter(""); setStatusFilter("all"); }}>
                      Clear filter
                    </button>
                  </div>
                </div>
              ) : empty ? (
                <div className="sessions__graphblank">
                  <div className="sessions__graphblank__card">
                    <b>No sessions in range</b>
                    <span>{daemonDown ? "Start the daemon, then refresh." : "Create a session to begin persistent work."}</span>
                    {!daemonDown && (
                      <button className="sessions__graphblank__link" onClick={handleNew}>
                        New session
                      </button>
                    )}
                  </div>
                </div>
              ) : null}
            </>
          ) : (
            <SessionTree session={selected} />
          )}
        </div>

        <div className="sessions__detailwrap">
          {selected ? (
            <div className="sessions__detail">
              <SessionDetail
                session={selected}
                onSwitch={() => void act(() => ipc.switchSession(selected.id), "Switch")}
                onResume={() => void act(() => ipc.resumeSession(selected.id), "Resume")}
                onFork={() => void act(() => ipc.forkSession(selected.id), "Fork")}
              />
            </div>
          ) : (
            <div className="detail__empty">
              <div className="radar">◈</div>
              <b>Select a session</b>
              <p>Choose a session node in the graph to inspect its telemetry, transcript, goals, and subagents.</p>
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
