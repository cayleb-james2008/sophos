// McpServersPanel — MCP servers card.

import { Text, Card, Badge } from "../../design";
import { LinkIcon } from "../sessions/icons";

export type McpServer = { name: string; command: string; args?: string[]; enabled: boolean };

export function McpServersPanel({
  servers,
  onChange,
}: {
  servers: McpServer[];
  onChange: (next: McpServer[]) => void;
}) {
  return (
    <Card variant="raised" padding="lg" style={{ display: "flex", flexDirection: "column", gap: 22 }}>
      <div className="sp-head">
        <div className="sp-headrow">
          <span className="sp-icon sp-icon--dim">
            <LinkIcon size={16} />
          </span>
          <Text variant="label" weight="semibold">
            MCP servers
          </Text>
          <Badge tone="neutral">{servers.length}</Badge>
        </div>
      </div>

      {servers.length === 0 ? (
        <Text variant="body" tone="dim">
          No MCP servers configured. Add servers in settings.json under "mcpServers" or via the daemon config.
        </Text>
      ) : (
        <div className="sp-list">
          {servers.map((s, idx) => (
            <div key={s.name} className="sp-row">
              <div className="sp-rowmain">
                <div className="sp-headrow--sm">
                  <Text variant="label" weight="medium" className="sp-ellipsis">
                    {s.name}
                  </Text>
                  <Badge tone={s.enabled ? "success" : "neutral"} dot>
                    {s.enabled ? "Enabled" : "Disabled"}
                  </Badge>
                </div>
                <Text variant="micro" tone="dim" mono className="sp-ellipsis">
                  {s.command} {s.args?.join(" ") ?? ""}
                </Text>
              </div>
              <label className="sp-check">
                <input
                  type="checkbox"
                  checked={s.enabled}
                  onChange={(e) => {
                    const next = [...servers];
                    next[idx] = { ...next[idx], enabled: e.target.checked };
                    onChange(next);
                  }}
                  className="sp-checkbox"
                />
                <Text variant="micro" tone="muted">Enable</Text>
              </label>
            </div>
          ))}
        </div>
      )}

      <Text variant="micro" tone="dim">
        MCP servers are configured in the daemon's settings.json. Changes here persist to settings and take effect on daemon restart.
      </Text>
    </Card>
  );
}
