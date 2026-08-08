// DaemonStatusBanner — the in-app daemon-status surface.
//
// The daemon used to fail silently: if the Windows named-pipe transport was
// wedged (CreateNamedPipeW / bind failing) the connection just never came up
// and the UI sat on "connecting" forever. This banner turns that silent
// failure into a plain-English explanation plus a one-click escape hatch:
// switching the daemon to the TCP-loopback fallback transport
// (`daemonTcp: true`, persisted to ~/.prime/agent/settings.json and honored by
// the Rust shell on next launch).
//
// It renders only when the connection is actually down (disconnected /
// reconnecting), so normal operation stays untouched.

import { useCallback, useEffect, useState } from "react";
import { tokens } from "../../design/tokens";
import { Text, Button, Card, StatusDot } from "../../design";
import { useConnectionState, useIpc } from "../../ipc/client";
import type { ConnectionStatus, Settings } from "../../ipc/contract";

type SurfaceState = "idle" | "enabling" | "enabled" | "error";

function plainEnglishReason(status: ConnectionStatus): string {
  if (status.kind === "disconnected" && status.reason) {
    return status.reason;
  }
  // Generic fallbacks when the bridge/Rust only gave us a kind.
  if (status.kind === "reconnecting") {
    return "Reconnecting to the agent engine. If this persists, the engine may have failed to start on the Windows named-pipe transport.";
  }
  return "The agent engine is not running. If the daemon failed to start because Windows named-pipe creation is blocked while TCP loopback still works, switch to TCP mode below and restart.";
}

export function DaemonStatusBanner({ onRestartRequest }: { onRestartRequest?: () => void }) {
  const ipc = useIpc();
  const conn = useConnectionState();
  const status = conn.status;
  const isDown = status.kind === "disconnected" || status.kind === "reconnecting";

  const [daemonTcp, setDaemonTcp] = useState<boolean | undefined>(undefined);
  const [surface, setSurface] = useState<SurfaceState>("idle");
  const [error, setError] = useState<string | undefined>(undefined);

  useEffect(() => {
    let mounted = true;
    ipc
      .getSettings()
      .then((s) => {
        if (mounted) setDaemonTcp(s.daemonTcp ?? false);
      })
      .catch(() => {
        if (mounted) setDaemonTcp(false);
      });
    return () => {
      mounted = false;
    };
  }, [ipc]);

  const enableTcp = useCallback(async () => {
    setSurface("enabling");
    setError(undefined);
    try {
      await ipc.setSettings({ daemonTcp: true } as Settings);
      setDaemonTcp(true);
      setSurface("enabled");
    } catch (err) {
      setSurface("error");
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [ipc]);

  if (!isDown) return null;

  const tcpAlreadyOn = daemonTcp === true;

  return (
    <div
      style={{
        position: "sticky",
        top: 0,
        zIndex: 50,
        padding: tokens.space.md,
        display: "flex",
        justifyContent: "center",
        pointerEvents: "none",
      }}
    >
      <Card
        variant="raised"
        padding="md"
        style={{
          pointerEvents: "auto",
          maxWidth: 720,
          width: "100%",
          display: "flex",
          flexDirection: "column",
          gap: tokens.space.sm,
          border: `1px solid ${tokens.color.border}`,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: tokens.space.sm }}>
          <StatusDot state={status.kind} />
          <Text variant="label" tone="danger">
            Agent engine offline
          </Text>
        </div>

        <Text variant="body" tone="muted">
          {plainEnglishReason(status)}
        </Text>

        {tcpAlreadyOn ? (
          <Text variant="micro" tone="muted">
            TCP mode is already enabled. Restart the app to relaunch the engine on the TCP-loopback
            transport.
          </Text>
        ) : (
          <div style={{ display: "flex", alignItems: "center", gap: tokens.space.sm, flexWrap: "wrap" }}>
            <Button
              variant="primary"
              size="sm"
              disabled={surface === "enabling"}
              onClick={() => void enableTcp()}
            >
              {surface === "enabling" ? "Enabling…" : "Enable TCP mode"}
            </Button>
            {surface === "enabled" && (
              <Text variant="micro" tone="success">
                Saved. Restart the app to apply.
              </Text>
            )}
            {surface === "error" && (
              <Text variant="micro" tone="danger">
                {error ?? "Could not save setting."}
              </Text>
            )}
          </div>
        )}

        {onRestartRequest && (
          <Button variant="ghost" size="sm" onClick={onRestartRequest}>
            Restart engine
          </Button>
        )}
      </Card>
    </div>
  );
}
