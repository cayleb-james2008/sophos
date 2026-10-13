// DaemonPanel — daemon transport status and diagnostics. TCP fallback is shown
// as unavailable while Sophos pins Prime Agent v0.7.0.

import { Text, Card, Badge, Button } from "../../design";
import { PlugIcon, CpuIcon, RefreshIcon } from "../sessions/icons";

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
  return (
    <Card variant="raised" padding="lg" className="card-stack--compact">
      <div className="sp-head">
        <div className="sp-headrow--sm">
          <PlugIcon size={16} />
          <Text variant="label">Daemon transport</Text>
        </div>
        <DaemonToggle checked={false} onChange={() => undefined} disabled />
      </div>
      <Text variant="body" tone="muted">
        TCP fallback is unsupported by pinned Prime Agent v0.7.0. Sophos continues using the default local socket.
      </Text>
    </Card>
  );
}

export function DaemonDiagnosticsCard({ status, onRefresh }: { status: { connected: boolean; tcpEnabled?: boolean; socketPath?: string }; onRefresh: () => void }) {
  return (
    <Card variant="raised" padding="lg" className="card-stack">
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
            Daemon transport
          </Text>
          <Text variant="label" mono weight="medium">
            Pinned default local socket (TCP unsupported)
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
        TCP fallback is unsupported by pinned Prime Agent v0.7.0; the engine stays on the default local socket.
      </Text>
    </Card>
  );
}
