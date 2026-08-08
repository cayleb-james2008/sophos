// EnginePanel — the in-app Engine Terminal, redesigned (P9): a live process
// graph (bridge → daemon → workers) with status-colored nodes on top, and the
// existing monospace log stream below it. Live status comes from engine status
// events + the connection state's RLM child fleet; log lines stream in via the
// `engine-log` Tauri events. Browser preview shows the process graph in a
// clear preview state with no fake logs.

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { tokens } from "../../design/tokens";
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

// ---------------------------------------------------------------------------
// Helper: color log lines by process/stream
// ---------------------------------------------------------------------------

function logColor(proc: string, stream: string): string {
  if (stream === "stderr") return tokens.color.warning;
  if (proc === "daemon") return tokens.color.info;
  return tokens.color.textMuted;
}

function logPrefix(proc: string, stream: string): string {
  const p = proc === "daemon" ? "DAEMON" : "ENGINE";
  const s = stream === "stderr" ? "ERR" : "OUT";
  return `[${p} ${s}]`;
}

// ---------------------------------------------------------------------------
// EnginePanel
// ---------------------------------------------------------------------------

export function EnginePanel({ open }: { open: boolean }) {
  const [logs, setLogs] = useState<EngineLogEntry[]>([]);
  const [status, setStatus] = useState<EngineStatus | null>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const [restarting, setRestarting] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inTauri = useMemo(() => isInTauri(), []);
  const conn = useConnectionState();
  const workers = conn.rlmChildren ?? [];

  // Initial load + event subscription
  useEffect(() => {
    if (!inTauri) return;

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
  }, [inTauri]);

  // Poll engine status every 3s (lightweight)
  useEffect(() => {
    if (!inTauri) return;
    const interval = setInterval(async () => {
      const s = await invokeEngineStatus();
      if (s) setStatus(s);
    }, 3000);
    return () => clearInterval(interval);
  }, [inTauri]);

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

  const dotState: StatusDotState = !inTauri
    ? "idle"
    : status?.daemon_alive && status?.sidecar_alive
    ? "connected"
    : status && (!status.daemon_alive || !status.sidecar_alive)
    ? "disconnected"
    : "connecting";

  const statusLabel = !inTauri
    ? "Browser Preview"
    : status?.daemon_alive && status?.sidecar_alive
    ? "Engine Running"
    : status && !status.daemon_alive && !status.sidecar_alive
    ? "Engine Stopped"
    : "Engine Partial";

  return (
    <div
      style={{
        display: open ? "flex" : "none",
        flexDirection: "column",
        height: "100%",
        background: tokens.color.bg,
        borderTop: `1px solid ${tokens.color.border}`,
      }}
    >
      {/* Panel header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: `0 ${tokens.space.lg}`,
          height: 36,
          flexShrink: 0,
          background: tokens.color.bgElevated,
          borderBottom: `1px solid ${tokens.color.border}`,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: tokens.space.md }}>
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
        <div style={{ display: "flex", alignItems: "center", gap: tokens.space.sm }}>
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
      <div
        style={{
          flexShrink: 0,
          height: 168,
          borderBottom: `1px solid ${tokens.color.border}`,
          background: tokens.color.bg,
          minHeight: 0,
        }}
      >
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
        style={{
          flex: 1,
          overflow: "auto",
          padding: `${tokens.space.sm} ${tokens.space.lg}`,
          fontFamily: tokens.font.mono,
          fontSize: tokens.font.size.xs,
          lineHeight: 1.55,
          background: tokens.color.bg,
          minHeight: 0,
        }}
      >
        {!inTauri ? (
          <BrowserPreviewState />
        ) : logs.length === 0 ? (
          <div style={{ padding: `${tokens.space.xl} 0`, textAlign: "center" }}>
            <Text variant="micro" tone="dim" mono>
              No engine output yet. Waiting for daemon + sidecar to start...
            </Text>
          </div>
        ) : (
          logs.map((entry, i) => (
            <div
              key={i}
              style={{
                display: "flex",
                gap: tokens.space.sm,
                padding: "1px 0",
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
              }}
            >
              <span style={{ color: tokens.color.textDim, flexShrink: 0, fontSize: tokens.font.size.xs, opacity: 0.5 }}>
                {entry.ts.slice(11, 19)}
              </span>
              <span style={{ color: logColor(entry.proc, entry.stream), flexShrink: 0, fontWeight: 600 }}>
                {logPrefix(entry.proc, entry.stream)}
              </span>
              <span style={{ color: tokens.color.text }}>{entry.line}</span>
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
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: tokens.space.md,
        padding: `${tokens.space["3xl"]} ${tokens.space.xl}`,
        textAlign: "center",
      }}
    >
      <div
        style={{
          width: 48,
          height: 48,
          borderRadius: tokens.radius.full,
          background: tokens.color.bgRaised,
          border: `1px solid ${tokens.color.border}`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: tokens.color.textDim,
        }}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
          <polyline points="4 17 10 11 4 5" />
          <line x1="12" y1="19" x2="20" y2="19" />
        </svg>
      </div>
      <Text variant="label" tone="muted" weight="medium">
        Engine not connected (browser preview)
      </Text>
      <Text variant="micro" tone="dim" mono style={{ maxWidth: 400 }}>
        Run the app with `npm run tauri dev` to see live daemon + sidecar process
        output streaming here. Restart and Stop controls are disabled in the
        browser preview.
      </Text>
    </div>
  );
}
