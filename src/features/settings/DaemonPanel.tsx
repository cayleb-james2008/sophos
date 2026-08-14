// DaemonPanel — daemon-related cards: transport fallback toggle, transport
// details, and diagnostics. Grouped from AdvancedPanel.

import { useCallback, useEffect, useState } from "react";
import { Text, Card, Badge, Button } from "../../design";
import { useIpc } from "../../ipc/client";
import type { Settings } from "../../ipc/contract";
import { PlugIcon, CpuIcon, RefreshIcon } from "../sessions/icons";

// ---------------------------------------------------------------------------
// Daemon transport — TCP-loopback fallback toggle.
//
// When the Windows named-pipe transport is wedged (CreateNamedPipeW failing),
// this flips `daemonTcp` on (persisted to ~/.prime/agent/settings.json and
// honored by the Rust shell on next launch), switching the daemon IPC to TCP
// loopback. The Rust shell + bridge both read the same flag, so they always
// agree on the endpoint.
// ---------------------------------------------------------------------------

function DaemonToggle({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <Button
      variant={checked ? "accent-soft" : "ghost"}
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => !disabled && onChange(!checked)}
      className={`dp-toggle ${checked ? "dp-toggle--on" : "dp-toggle--off"}`}
    >
      <span className={`dp-toggleknob${checked ? " dp-toggleknob--on" : ""}`} />
    </Button>
  );
}

export function DaemonTransportCard() {
  const ipc = useIpc();
  const [value, setValue] = useState<boolean>(false);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let mounted = true;
    ipc
      .getSettings()
      .then((s) => {
        if (mounted) {
          setValue(s.daemonTcp ?? false);
          setLoaded(true);
        }
      })
      .catch(() => mounted && setLoaded(true));
    return () => {
      mounted = false;
    };
  }, [ipc]);

  const onToggle = useCallback(
    async (next: boolean) => {
      setValue(next);
      setSaving(true);
      setSaved(false);
      try {
        await ipc.setSettings({ daemonTcp: next } as Settings);
        setSaved(true);
      } finally {
        setSaving(false);
      }
    },
    [ipc],
  );

  return (
    <Card variant="raised" padding="lg" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div className="sp-head">
        <div className="sp-headrow--sm">
          <PlugIcon size={16} />
          <Text variant="label">Daemon transport</Text>
        </div>
        <DaemonToggle checked={value} onChange={(n) => void onToggle(n)} disabled={!loaded || saving} />
      </div>
      <Text variant="body" tone="muted">
        Uses the Windows named-pipe transport by default. If the engine fails to start (named-pipe
        creation blocked), enable TCP loopback as a fallback. Takes effect after a restart.
      </Text>
      {saved && (
        <Text variant="micro" tone="success">
          Saved. Restart the app to relaunch the engine on the selected transport.
        </Text>
      )}
      {value && (
        <Badge tone="info">TCP loopback fallback armed</Badge>
      )}
    </Card>
  );
}

export function DaemonDiagnosticsCard({ status, onRefresh }: { status: { connected: boolean; tcpEnabled?: boolean; socketPath?: string }; onRefresh: () => void }) {
  return (
    <Card variant="raised" padding="lg" style={{ display: "flex", flexDirection: "column", gap: 22 }}>
      <div className="sp-head">
        <div className="sp-headrow">
          <span className={`sp-icon${status.connected ? " sp-icon--ok" : " sp-icon--err"}`}>
            <CpuIcon size={16} />
          </span>
          <Text variant="label" weight="semibold">
            Daemon diagnostics
          </Text>
          <Badge tone={status.connected ? "success" : "danger"} dot>
            {status.connected ? "Connected" : "Disconnected"}
          </Badge>
        </div>
        <Button variant="ghost" size="sm" icon={<RefreshIcon size={13} />} onClick={onRefresh}>
          Refresh
        </Button>
      </div>

      <div className="dp-grid">
        <div className="dp-stat">
          <Text variant="micro" tone="dim" uppercase>
            Daemon status
          </Text>
          <Text variant="label" mono weight="medium" className={`dp-statval${status.connected ? " dp-statval--ok" : " dp-statval--err"}`}>
            {status.connected ? "Connected" : "Disconnected"}
          </Text>
        </div>
        <div className="dp-stat">
          <Text variant="micro" tone="dim" uppercase>
            TCP transport
          </Text>
          <Text variant="label" mono weight="medium">
            {status.tcpEnabled ? "Enabled" : "Disabled (Unix domain socket)"}
          </Text>
        </div>
        <div className="dp-stat">
          <Text variant="micro" tone="dim" uppercase>
            Socket path
          </Text>
          <Text variant="micro" tone="dim" mono className="ap-cwd">
            {status.socketPath ?? "—"}
          </Text>
        </div>
      </div>

      <Text variant="micro" tone="dim">
        Daemon connection is managed by the Rust shell via the Node bridge. TCP toggle (P1) will appear here when available.
      </Text>
    </Card>
  );
}
