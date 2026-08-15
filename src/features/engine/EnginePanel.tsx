// EnginePanel — the in-app Engine Terminal, redesigned (P9): a live process
// graph (bridge → daemon → workers) with status-colored nodes on top, and the
// existing monospace log stream below it. Live status comes from engine status
// events + the connection state's RLM child fleet; log lines stream in via the
// `engine-log` Tauri events. Browser preview shows the process graph in a
// clear preview state with no fake logs.

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { Text, Button, StatusDot, Badge } from "../../design";
import type { StatusDotState } from "../../design";
import { useConnectionState } from "../../ipc/client";
import { EngineGraph } from "./EngineGraph";
import "./engine.css";

// ---------------------------------------------------------------------------
// Types — match the Rust EngineLogEntry shape
// ---------------------------------------------------------------------------

interface EngineLogEntry {
  proc: "daemon" | "sidecar";
  stream: "stdout" | "stderr";
  line: string;
  ts: string;
}

interface EngineStatus {
  daemon_alive: boolean;
  sidecar_alive: boolean;
}

// ---------------------------------------------------------------------------
// Tauri invoke helpers
// ---------------------------------------------------------------------------

async function invokeEngineLogs(): Promise<EngineLogEntry[]> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke<EngineLogEntry[]>("get_engine_logs");
  } catch {
    return [];
  }
}

async function invokeEngineStatus(): Promise<EngineStatus | null> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke<EngineStatus>("get_engine_status");
  } catch {
    return null;
  }
}

async function invokeRestart(): Promise<void> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("restart_engine");
  } catch {
    // no-op
  }
}

async function invokeStop(): Promise<void> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("stop_engine");
  } catch {
    // no-op
  }
}

// Detect if running in Tauri (not browser preview)
function isInTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

// Detect the real Tauri app launched in demo mode (`--demo` / SOPHOS_DEMO_MODE=1):
// the Rust shell injects `window.__SOPHOS_DEMO__ = true`. In that mode the app
// skips the daemon + sidecar, so the Tauri engine invokes (`get_engine_logs`,
// `get_engine_status`) have nothing to answer with. Rather than showing a dead,
// empty terminal, demo mode presents a simulated live engine — status dots lit,
// process graph live, and a clearly-labeled demo log stream — so the Engine
// Terminal is fully demonstrable and testable without a live daemon.
function isDemoShell(): boolean {
  return typeof window !== "undefined" && (window as any).__SOPHOS_DEMO__ === true;
}

/** Simulated engine log stream shown in demo mode (clearly labeled as a demo). */
const DEMO_ENGINE_STATUS: EngineStatus = { daemon_alive: true, sidecar_alive: true };

const DEMO_ENGINE_LOGS: EngineLogEntry[] = [
  { proc: "daemon", stream: "stdout", line: "Sophos agent daemon starting (demo mode — simulated engine)", ts: new Date(Date.now() - 120000).toISOString() },
  { proc: "sidecar", stream: "stdout", line: "IPC bridge connecting to daemon...", ts: new Date(Date.now() - 118000).toISOString() },
  { proc: "daemon", stream: "stdout", line: "daemon listening on tcp://127.0.0.1", ts: new Date(Date.now() - 115000).toISOString() },
  { proc: "sidecar", stream: "stdout", line: "bridge connected · session-0 ready", ts: new Date(Date.now() - 112000).toISOString() },
  { proc: "daemon", stream: "stdout", line: "kernel: persistent IPython ready", ts: new Date(Date.now() - 110000).toISOString() },
  { proc: "daemon", stream: "stdout", line: "free model: DeepSeek V4 Flash 0731 ready", ts: new Date(Date.now() - 108000).toISOString() },
  { proc: "daemon", stream: "stderr", line: "(demo) engine log output is simulated — no real daemon is running", ts: new Date(Date.now() - 105000).toISOString() },
];

// ---------------------------------------------------------------------------
// Helper: color log lines by process/stream
// ---------------------------------------------------------------------------

function logPrefix(proc: string, stream: string): string {
  const p = proc === "daemon" ? "DAEMON" : "ENGINE";
  const s = stream === "stderr" ? "ERR" : "OUT";
  return `[${p} ${s}]`;
}

// ---------------------------------------------------------------------------
// EnginePanel
// ---------------------------------------------------------------------------

export function EnginePanel({ open }: { open: boolean }) {
  const inTauri = useMemo(() => isInTauri(), []);
  const demo = useMemo(() => isDemoShell(), []);
  // `live` gates the real Tauri engine invokes: only when running in the real
  // (non-demo) Tauri shell. In demo mode the daemon is skipped, so the terminal
  // renders a simulated live engine instead.
  const live = inTauri && !demo;
  const [logs, setLogs] = useState<EngineLogEntry[]>(() => (demo ? DEMO_ENGINE_LOGS : []));
  const [status, setStatus] = useState<EngineStatus | null>(() => (demo ? DEMO_ENGINE_STATUS : null));
  const [autoScroll, setAutoScroll] = useState(true);
  const [restarting, setRestarting] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const conn = useConnectionState();
  const workers = conn.rlmChildren ?? [];

  // Initial load + event subscription (real Tauri engine only)
  useEffect(() => {
    if (!live) return;

    let unlisten: (() => void) | undefined;

    (async () => {
      const [initialLogs, initialStatus] = await Promise.all([invokeEngineLogs(), invokeEngineStatus()]);
      setLogs(initialLogs);
      setStatus(initialStatus);

      try {
        const { listen } = await import("@tauri-apps/api/event");
        const un = await listen<EngineLogEntry>("engine-log", (e) => {
          setLogs((prev) => {
            const next = [...prev, e.payload];
            if (next.length > 2000) return next.slice(-2000);
            return next;
          });
        });
        unlisten = un;
      } catch {
        // no-op
      }
    })();

    return () => {
      unlisten?.();
    };
  }, [live]);

  // Poll engine status every 3s (lightweight) — real Tauri engine only.
  useEffect(() => {
    if (!live) return;
    const interval = setInterval(async () => {
      const s = await invokeEngineStatus();
      if (s) setStatus(s);
    }, 3000);
    return () => clearInterval(interval);
  }, [live]);

  // Auto-scroll to bottom when new logs arrive
  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs, autoScroll, open]);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 30;
    setAutoScroll(atBottom);
  }, []);

  const handleClear = useCallback(() => setLogs([]), []);
  const handleRestart = useCallback(async () => {
    setRestarting(true);
    await invokeRestart();
    setTimeout(() => setRestarting(false), 500);
  }, []);
  const handleStop = useCallback(async () => { await invokeStop(); }, []);

  const dotState: StatusDotState = !inTauri && !demo
    ? "idle"
    : status?.daemon_alive && status?.sidecar_alive
    ? "connected"
    : status && (!status.daemon_alive || !status.sidecar_alive)
    ? "disconnected"
    : "connecting";

  const statusLabel = !inTauri && !demo
    ? "Browser Preview"
    : status?.daemon_alive && status?.sidecar_alive
    ? "Engine Running"
    : status && !status.daemon_alive && !status.sidecar_alive
    ? "Engine Stopped"
    : "Engine Partial";

  return (
    <div className={`engine-panel${open ? "" : " engine-panel--hidden"}`}>
      {/* Panel header */}
      <div className="engine-panel__head">
        <div className="engine-panel__headleft">
          <StatusDot state={dotState} size={7} />
          <Text variant="micro" tone="dim" mono uppercase>
            Engine Terminal
          </Text>
          <Badge tone={dotState === "connected" ? "success" : dotState === "disconnected" ? "danger" : dotState === "idle" ? "neutral" : "warning"}>
            {statusLabel}
          </Badge>
          {inTauri && status && (
            <>
              <Text variant="micro" tone="dim" mono>daemon {status.daemon_alive ? "●" : "○"}</Text>
              <Text variant="micro" tone="dim" mono>sidecar {status.sidecar_alive ? "●" : "○"}</Text>
            </>
          )}
        </div>
        <div className="engine-panel__headright">
          <Button variant="outline" size="sm" onClick={handleRestart} loading={restarting} disabled={!inTauri}>
            Restart
          </Button>
          <Button variant="danger" size="sm" onClick={handleStop} disabled={!inTauri}>
            Stop
          </Button>
          <Button variant="ghost" size="sm" onClick={handleClear}>
            Clear
          </Button>
        </div>
      </div>

      {/* Live process graph */}
      <div className="engine-panel__graph">
        <EngineGraph
          daemonAlive={status?.daemon_alive}
          sidecarAlive={status?.sidecar_alive}
          workers={workers}
          preview={!inTauri}
        />
      </div>

      {/* Terminal body */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="engine-panel__body"
      >
        {!inTauri && !demo ? (
          <BrowserPreviewState />
        ) : logs.length === 0 ? (
          <div className="engine-panel__empty">
            <Text variant="micro" tone="dim" mono>
              No engine output yet. Waiting for daemon + sidecar to start...
            </Text>
          </div>
        ) : (
          logs.map((entry, i) => (
            <div
              key={i}
              className="engine-panel__line"
            >
              <span className="engine-panel__ts">
                {entry.ts.slice(11, 19)}
              </span>
              <span className={`engine-panel__prefix${entry.stream === "stderr" ? " engine-panel__prefix--err" : entry.proc === "daemon" ? " engine-panel__prefix--daemon" : ""}`}>
                {logPrefix(entry.proc, entry.stream)}
              </span>
              <span className="engine-panel__text">{entry.line}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Browser preview state — shown when running in `npm run dev` without Tauri
// ---------------------------------------------------------------------------

function BrowserPreviewState() {
  return (
    <div className="engine-panel__preview">
      <div className="engine-panel__previewicon">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
          <polyline points="4 17 10 11 4 5" />
          <line x1="12" y1="19" x2="20" y2="19" />
        </svg>
      </div>
      <Text variant="label" tone="muted" weight="medium">
        Engine not connected (browser preview)
      </Text>
      <Text variant="micro" tone="dim" mono className="engine-panel__previewdesc">
        Run the app with `npm run tauri dev` to see live daemon + sidecar process
        output streaming here. Restart and Stop controls are disabled in the
        browser preview.
      </Text>
    </div>
  );
}
