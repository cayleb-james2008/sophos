// Sidebar — the conversation-first rail (v0.7). In the Chat view it reads like
// Claude Desktop / Codex: a New chat button, the session history below it, and
// the secondary areas (Sessions / Agents / Inbox / Settings) demoted to a
// quiet rail at the bottom. On the other views the history collapses so those
// panels keep the full width; the rail stays identical everywhere.
//
// Live session list comes from listSessions() + the connection state's
// activeSessionId, so clicking a history item resumes that session and lands
// in the conversation. New chat creates a fresh session in place.

import { useCallback, useEffect, useMemo, useState } from "react";
import { Text, Tooltip, Kbd, Badge, IconButton } from "../design";
import { useUnreadBadge } from "../ipc/unread";
import { useIpc, useConnectionState } from "../ipc/client";
import type { SessionInfo } from "../ipc/contract";
import { SigmaGlyph, SearchIcon } from "./icons";
import { NAV_ITEMS, type View } from "./nav";
import { relativeTime } from "../features/sessions/format";

export function Sidebar({
  active,
  onNavigate,
}: {
  active: View;
  onNavigate: (view: View) => void;
}) {
  const ipc = useIpc();
  const conn = useConnectionState();
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [query, setQuery] = useState("");
  const activeSessionId = conn.activeSessionId;

  const refresh = useCallback(async () => {
    try {
      const list = await ipc.listSessions();
      setSessions(Array.isArray(list) ? list : []);
    } catch {
      // Daemon down — keep the previous list; the chat view degrades gracefully.
    }
  }, [ipc]);

  useEffect(() => {
    void refresh();
  }, [refresh, activeSessionId]);

  // Keep the list fresh when sessions change (new/fork/clone via other views).
  useEffect(() => {
    const unsubscribe = ipc.onEvent((event) => {
      if (event.type === "session_event" && event.event?.kind === "session_created") {
        void refresh();
      }
    });
    return unsubscribe;
  }, [ipc, refresh]);

  const handleNewChat = async () => {
    try {
      await ipc.newSession();
    } catch {
      // Best-effort: the Sessions panel is the authoritative creator.
    }
    setQuery("");
    await refresh();
  };

  const handleOpenSession = async (session: SessionInfo) => {
    try {
      await ipc.resumeSession(session.id);
    } catch {
      // If resume fails (daemon down), still show the conversation surface.
    }
    if (active !== "chat") onNavigate("chat");
  };

  const showHistory = active === "chat";
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const sorted = [...sessions].sort((a, b) =>
      (b.updatedAt ?? b.createdAt ?? "").localeCompare(a.updatedAt ?? a.createdAt ?? ""),
    );
    if (!q) return sorted;
    return sorted.filter((s) => (s.title ?? s.id).toLowerCase().includes(q));
  }, [sessions, query]);

  return (
    <aside className="sidebar">
      {/* Brand */}
      <div className="sidebar__brand">
        <span className="sidebar__brand-mark" aria-hidden="true">
          <SigmaGlyph size={14} />
        </span>
        <span className="sidebar__wordmark">SOPHOS</span>
        <span className="sidebar__version">v0.7.2-beta</span>
      </div>

      {/* New chat */}
      <button type="button" className="pa-focus-ring sidebar__newchat" onClick={() => void handleNewChat()}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
          <line x1="12" y1="5" x2="12" y2="19" />
          <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
        <span>New chat</span>
      </button>

      {/* Session history — only on the conversation view, so the Sessions graph
          stays the unambiguous owner of session-node text. */}
      {showHistory ? (
        <div className="sidebar__history">
          <div className="sidebar__history-head">
            <Text variant="micro" tone="dim" mono uppercase className="sidebar__eyebrow-text">
              Recent
            </Text>
            {sessions.length > 0 ? (
              <Text variant="micro" tone="dim" mono>{sessions.length}</Text>
            ) : null}
          </div>

          <div className="sidebar__search">
            <span className="sidebar__search-icon" aria-hidden="true">
              <SearchIcon size={12} color="currentColor" />
            </span>
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search conversations…"
              aria-label="Search conversations"
              className="sidebar__search-input"
            />
            {query ? (
              <IconButton
                className="sidebar__search-clear"
                onClick={() => setQuery("")}
                title="Clear search"
                size="sm"
              >
                ✕
              </IconButton>
            ) : null}
          </div>

          <nav className="sidebar__history-list" aria-label="Session history">
            {filtered.map((session) => {
              const isActive = session.id === activeSessionId;
              return (
                <button
                  key={session.id}
                  type="button"
                  onClick={() => void handleOpenSession(session)}
                  aria-current={isActive ? "page" : undefined}
                  className={`pa-focus-ring sidebar__history-item${isActive ? " sidebar__history-item--active" : ""}`}
                  title={session.cwd ?? session.title ?? session.id}
                >
                  <span className="sidebar__history-title">{session.title ?? session.id}</span>
                  <span className="sidebar__history-meta">
                    {session.updatedAt || session.createdAt ? relativeTime(session.updatedAt ?? session.createdAt ?? "") : "—"}
                    {session.status === "active" ? <span className="sidebar__history-live" aria-label="active" /> : null}
                  </span>
                </button>
              );
            })}
            {filtered.length === 0 ? (
              <div className="sidebar__history-empty">
                <Text variant="micro" tone="dim">
                  {query ? "No conversations match your search." : "Start a conversation to see it here."}
                </Text>
              </div>
            ) : null}
          </nav>
        </div>
      ) : null}

      {/* Bottom rail — the demoted panels, always present */}
      <div className="sidebar__rail">
        <nav className="sidebar__nav" aria-label="Primary navigation">
          {NAV_ITEMS.map((item) => {
            const isActive = item.id === active;
            const Icon = item.icon;
            return (
              <Tooltip key={item.id} content={item.hint} side="right">
                <button
                  onClick={() => onNavigate(item.id)}
                  aria-current={isActive ? "page" : undefined}
                  className={`pa-focus-ring sidebar__item${isActive ? " sidebar__item--active" : ""}`}
                >
                  {isActive ? <span className="sidebar__active-mark" aria-hidden="true" /> : null}
                  <Icon size={16} color={isActive ? "var(--pa-green)" : "rgba(var(--pa-paper-rgb), 0.45)"} />
                  <span>{item.label}</span>
                  {item.id === "inbox" ? <InboxBadge /> : null}
                </button>
              </Tooltip>
            );
          })}
        </nav>

        <div className="sidebar__separator" />

        <div className="sidebar__footer">
          <div className="sidebar__command">
            <Text variant="micro" tone="dim" mono uppercase>
              Command
            </Text>
            <Kbd>⌘K</Kbd>
          </div>
        </div>
      </div>
    </aside>
  );
}

function InboxBadge() {
  const count = useUnreadBadge();
  if (!count) return null;
  return (
    <span className="sidebar__badge">
      <Badge tone="danger">{count}</Badge>
    </span>
  );
}
