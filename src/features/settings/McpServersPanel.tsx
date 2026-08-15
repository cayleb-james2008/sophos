// McpServersPanel — MCP servers card. Interactive add / remove / test / toggle
// entirely from the UI — no manual settings.json editing required.

import { useState } from "react";
import { Text, Card, Badge, Button, Input, Spinner } from "../../design";
import { LinkIcon, XIcon } from "../sessions/icons";
import type { McpTestResult } from "../../ipc/contract";

export type McpServer = { name: string; command: string; args?: string[]; enabled: boolean };

export function McpServersPanel({
  servers,
  onChange,
  onAdd,
  onTest,
  onRemove,
}: {
  servers: McpServer[];
  onChange: (next: McpServer[]) => void;
  onAdd: (name: string, command: string, args: string[]) => void;
  onTest: (name: string, command: string, args?: string[]) => Promise<McpTestResult>;
  onRemove: (name: string) => void;
}) {
  const [name, setName] = useState("");
  const [command, setCommand] = useState("");
  const [args, setArgs] = useState("");
  const [testing, setTesting] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, McpTestResult>>({});

  const canAdd = name.trim().length > 0 && command.trim().length > 0;

  const handleAdd = () => {
    if (!canAdd) return;
    onAdd(name.trim(), command.trim(), args.trim() ? args.trim().split(/\s+/) : []);
    setName("");
    setCommand("");
    setArgs("");
  };

  const handleTest = async (s: McpServer) => {
    setTesting(s.name);
    setResults((prev) => ({ ...prev, [s.name]: { serverName: s.name, connected: false } }));
    try {
      const result = await onTest(s.name, s.command, s.args);
      setResults((prev) => ({ ...prev, [s.name]: result }));
    } catch (e) {
      setResults((prev) => ({
        ...prev,
        [s.name]: { serverName: s.name, connected: false, error: e instanceof Error ? e.message : "Test failed" },
      }));
    } finally {
      setTesting((t) => (t === s.name ? null : t));
    }
  };

  return (
    <Card variant="raised" padding="lg" className="card-stack">
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

      {/* Add server form — always visible, not hidden behind a toggle. */}
      <div className="mcp-add">
        <Text variant="micro" tone="muted" uppercase>
          Add server
        </Text>
        <div className="mcp-addgrid">
          <Input
            label="Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. filesystem"
          />
          <Input
            label="Command"
            value={command}
            onChange={(e) => setCommand(e.target.value)}
            placeholder="e.g. npx"
          />
          <Input
            label="Arguments"
            value={args}
            onChange={(e) => setArgs(e.target.value)}
            placeholder="space-separated, e.g. -y @modelcontextprotocol/server-filesystem"
          />
        </div>
        <div className="mcp-addfoot">
          <Button size="sm" onClick={handleAdd} disabled={!canAdd}>
            Add
          </Button>
        </div>
      </div>

      {servers.length === 0 ? (
        <Text variant="body" tone="dim">
          No MCP servers configured yet. Add one below to get started.
        </Text>
      ) : (
        <div className="sp-list">
          {servers.map((s, idx) => {
            const result = results[s.name];
            const isTesting = testing === s.name;
            return (
              <div key={s.name} className="sp-row mcp-row">
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
                  {isTesting ? (
                    <div className="mcp-test mcp-test--pending">
                      <Spinner size={12} />
                      <Text variant="micro" tone="dim">
                        Testing connection…
                      </Text>
                    </div>
                  ) : result ? (
                    <div className={`mcp-test ${result.connected ? "mcp-test--ok" : "mcp-test--err"}`}>
                      {result.connected ? (
                        <Text variant="micro" tone="success">
                          Connected{result.latencyMs != null ? ` · ${result.latencyMs}ms` : ""}
                          {result.tools ? ` · ${result.tools.length} tools` : ""}
                        </Text>
                      ) : (
                        <Text variant="micro" tone="danger">
                          Failed{result.error ? ` · ${result.error}` : ""}
                        </Text>
                      )}
                    </div>
                  ) : null}
                </div>
                <div className="mcp-actions">
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
                  <Button size="sm" variant="outline" onClick={() => void handleTest(s)} disabled={isTesting}>
                    Test
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => onRemove(s.name)}
                    title={`Remove ${s.name}`}
                    aria-label={`Remove ${s.name}`}
                  >
                    <XIcon size={14} />
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <Text variant="micro" tone="dim">
        Changes here persist to settings and take effect on daemon restart.
      </Text>
    </Card>
  );
}
