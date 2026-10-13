// DaemonStatusBanner — the in-app daemon-status surface.
//
// Prime Agent v0.7.0 does not implement TCP fallback. Keep the offline surface
// diagnostic-only and do not offer a transport action the runtime ignores.

import { useConnectionState } from "../../ipc/client";
import { Text, Button, Card, StatusDot } from "../../design";
import type { ConnectionStatus } from "../../ipc/contract";

function plainEnglishReason(status: ConnectionStatus): string {
  if (status.kind === "disconnected" && status.reason) {
    return status.reason;
  }
  if (status.kind === "reconnecting") {
    return "Reconnecting to the agent engine on its default local socket.";
  }
  return "The agent engine is not running on its default local socket.";
}

export function DaemonStatusBanner({ onRestartRequest }: { onRestartRequest?: () => void }) {
  const status = useConnectionState().status;
  const isDown = status.kind === "disconnected" || status.kind === "reconnecting";

  if (!isDown) return null;

  return (
    <div className="dsb">
      <Card variant="raised" padding="md" className="dsb-card">
        <div className="dsb-head">
          <StatusDot state={status.kind} />
          <Text variant="label" tone="danger">
            Agent engine offline
          </Text>
        </div>

        <Text variant="body" tone="muted">
          {plainEnglishReason(status)}
        </Text>
        <Text variant="micro" tone="muted">
          TCP fallback is unsupported by pinned Prime Agent v0.7.0. Sophos continues using the supported default local socket.
        </Text>

        {onRestartRequest && (
          <Button variant="ghost" size="sm" onClick={onRestartRequest}>
            Restart engine
          </Button>
        )}
      </Card>
    </div>
  );
}
