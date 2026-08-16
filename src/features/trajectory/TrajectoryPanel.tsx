// TrajectoryPanel — the "every run is traceable" view (v0.7). A right-side
// drawer over the conversation showing the append-only event log for any
// session, with search, replay (step through the stream), resume (load the
// session into the conversation), and fork (branch from it) — all operating on
// the same event stream, per the DeepSeek Harness design principle.

import { useEffect, useMemo, useRef, useState } from "react";
import { Text, Button, IconButton, Spinner } from "../../design";
import { useIpc, useConnectionState } from "../../ipc/client";
import { useAppState } from "../../state/AppState";
import { useTrajectory, trajectorySessions, type TrajectoryEntry } from "./trajectory";
import "./trajectory.css";

function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function kindLabel(kind: TrajectoryEntry["kind"]): string {
  switch (kind) {
    case "prompt": return "Prompt";
    case "thinking": return "Thinking";
    case "tool": return "Tool";
    case "message": return "Message";
    case "state": return "State";
    case "agent": return "Agent";
    case "refinement": return "Refine";
    case "program": return "Program";
    default: return "System";
  }
}

export function TrajectoryPanel() {
  const { trajectoryOpen, setTrajectoryOpen, setView } = useAppState();
  const { logs, record } = useTrajectory();
  const ipc = useIpc();
  const conn = useConnectionState();
  const activeSessionId = conn.activeSessionId ?? "session-unknown";

  const sessions = useMemo(() => {
    const withLogs = trajectorySessions(logs);
    if (!withLogs.includes(activeSessionId)) return [activeSessionId, ...withLogs];
    return withLogs;
  }, [logs, activeSessionId]);

  const [selectedSession, setSelectedSession] = useState<string>(activeSessionId);
  const [query, setQuery] = useState("");
  const [replaying, setReplaying] = useState(false);
  const [cursor, setCursor] = useState(-1);
  const [playing, setPlaying] = useState(false);
  const [busy, setBusy] = useState(false);
  const timerRef = useRef<number | null>(null);

  // Keep the selector on the active session while the panel is open and a
  // session switch happens elsewhere.
  useEffect(() => {
    if (trajectoryOpen) setSelectedSession(activeSessionId);
  }, [trajectoryOpen, activeSessionId]);

  const entries = useMemo(() => logs[selectedSession] ?? [], [logs, selectedSession]);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return entries;
    return entries.filter((e) =>
      `${e.label} ${e.summary} ${e.detail ?? ""}`.toLowerCase().includes(q),
    );
  }, [entries, query]);

  useEffect(() => {
    setCursor(-1);
    setPlaying(false);
    setReplaying(false);
    if (timerRef.current) window.clearTimeout(timerRef.current);
  }, [query, selectedSession]);

  useEffect(() => () => {
    if (timerRef.current) window.clearTimeout(timerRef.current);
  }, []);

  // Replay driver: step the cursor through the filtered stream.
  useEffect(() => {
    if (!playing) return;
    if (cursor >= filtered.length - 1) {
      setPlaying(false);
      return;
    }
    timerRef.current = window.setTimeout(() => {
      setCursor((c) => Math.min(c + 1, filtered.length - 1));
    }, 450);
    return () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
    };
  }, [playing, cursor, filtered.length]);

  const startReplay = () => {
    setReplaying(true);
    setCursor(-1);
    setPlaying(true);
  };
  const stopReplay = () => {
    setPlaying(false);
    setReplaying(false);
    setCursor(-1);
  };

  const handleResume = async () => {
    setBusy(true);
    try {
      await ipc.resumeSession(selectedSession);
      record(selectedSession, { kind: "system", label: "Trajectory", summary: "Resumed session from the Trajectory view", detail: selectedSession, source: "trajectory" });
    } catch {
      // Daemon unreachable — nothing to resume against.
    } finally {
      setBusy(false);
      setTrajectoryOpen(false);
      setView("chat");
    }
  };

  const handleFork = async () => {
    setBusy(true);
    try {
      await ipc.forkSession(selectedSession);
      record(selectedSession, { kind: "system", label: "Trajectory", summary: "Forked session from the Trajectory view", detail: selectedSession, source: "trajectory" });
    } catch {
      // Fork needs a forkable entry; the Sessions panel is the fallback.
    } finally {
      setBusy(false);
    }
  };

  const cursorEntry = cursor >= 0 && cursor < filtered.length ? filtered[cursor] : null;

  return (
    <div className={`traj${trajectoryOpen ? " traj--open" : ""}`} aria-hidden={!trajectoryOpen}>
      {/* Backdrop */}
      <div className="traj__backdrop" onClick={() => setTrajectoryOpen(false)} aria-hidden="true" />

      {/* Drawer */}
      <aside className="traj__drawer" role="dialog" aria-label="Trajectory">
        <header className="traj__header">
          <div className="traj__heading">
            <Text variant="micro" tone="dim" mono uppercase>Every run is traceable</Text>
            <Text variant="subtitle" weight="semibold">Trajectory</Text>
          </div>
          <IconButton title="Close trajectory" onClick={() => setTrajectoryOpen(false)} size="sm">✕</IconButton>
        </header>

        {/* Session selector */}
        <div className="traj__controls">
          <label className="traj__select-wrap">
            <span className="traj__select-label">Session</span>
            <select
              value={selectedSession}
              onChange={(e) => setSelectedSession(e.target.value)}
              aria-label="Trajectory session"
              className="traj__select"
            >
              {sessions.map((id) => (
                <option key={id} value={id}>
                  {id === activeSessionId ? `${id} (active)` : id}
                </option>
              ))}
            </select>
          </label>

          <div className="traj__search">
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search the event log…"
              aria-label="Search trajectory events"
              className="traj__search-input"
            />
            {query ? (
              <IconButton className="traj__search-clear" onClick={() => setQuery("")} title="Clear search" size="sm">✕</IconButton>
            ) : null}
          </div>

          <div className="traj__actions">
            {!replaying ? (
              <Button variant="outline" size="sm" onClick={startReplay} disabled={filtered.length === 0} title="Replay the event stream">
                Replay
              </Button>
            ) : (
              <>
                <Button variant="accent-soft" size="sm" onClick={() => setPlaying((p) => !p)} title={playing ? "Pause replay" : "Play replay"}>
                  {playing ? "Pause" : "Play"}
                </Button>
                <Button variant="ghost" size="sm" onClick={stopReplay} title="Stop replay">Stop</Button>
              </>
            )}
            <Button variant="ghost" size="sm" onClick={() => void handleResume()} disabled={busy} title="Load this session into the conversation">
              {busy ? <Spinner size={12} /> : null} Resume
            </Button>
            <Button variant="ghost" size="sm" onClick={() => void handleFork()} disabled={busy} title="Branch a new session from this one">
              Fork
            </Button>
          </div>

          <div className="traj__meta">
            <Text variant="micro" tone="dim" mono>
              {filtered.length} event{filtered.length === 1 ? "" : "s"}
              {query ? " · filtered" : ""}
              {replaying && cursorEntry ? ` · step ${cursor + 1}/${filtered.length}` : ""}
            </Text>
          </div>
        </div>

        {/* Event stream */}
        <div className="traj__list" role="list" aria-label="Trajectory event log">
          {filtered.length === 0 ? (
            <div className="traj__empty">
              <Text variant="label" tone="muted">
                {query ? "No events match your search." : "No events recorded yet for this session. Send a message and the stream will appear here."}
              </Text>
            </div>
          ) : (
            filtered.map((entry, index) => {
              const highlighted = cursor === index;
              const isCurrent = index === filtered.length - 1;
              return (
                <div
                  key={entry.id}
                  role="listitem"
                  className={`traj__entry${highlighted ? " traj__entry--replay" : ""}${isCurrent ? " traj__entry--current" : ""}`}
                >
                  <div className="traj__entry-row">
                    <span className={`traj__kind traj__kind--${entry.kind}`}>{kindLabel(entry.kind)}</span>
                    <span className="traj__time">{formatTime(entry.ts)}</span>
                    <span className="traj__seq">#{entry.seq}</span>
                  </div>
                  <div className="traj__summary">{entry.summary || entry.label}</div>
                  {entry.detail && entry.detail !== entry.summary ? (
                    <details className="traj__detail">
                      <summary>details</summary>
                      <pre className="traj__pre">{entry.detail}</pre>
                    </details>
                  ) : null}
                </div>
              );
            })
          )}
        </div>

        {/* Replay footer */}
        {replaying ? (
          <div className="traj__replaybar">
            <div className="traj__replay-track">
              <div
                className="traj__replay-fill"
                style={{ width: filtered.length > 0 ? `${((cursor + 1) / filtered.length) * 100}%` : "0%" }}
              />
            </div>
            <Text variant="micro" tone="dim" mono>
              {cursorEntry ? cursorEntry.label : "ready"} — {cursor + 1}/{filtered.length}
            </Text>
          </div>
        ) : null}
      </aside>
    </div>
  );
}
