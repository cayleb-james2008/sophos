// McpExplorer — Comprehensive Anthropic Model Context Protocol (MCP v1.2+) Inspector.
// Provides live server discovery, health/latency monitoring, resource browsing/streaming,
// prompt template execution, and JSON tool schema inspection.

import { useCallback, useEffect, useState } from "react";
import { Badge, Button, Card, Input, Spinner, Tabs, Text } from "../../design";
import { getIpcClient } from "../../ipc/client";
import type { McpPromptTemplate, McpResource, McpServerDetails } from "../../ipc/contract";
import "./mcp.css";

export function McpExplorer({ onInjectPrompt }: { onInjectPrompt?: (text: string) => void }) {
  const client = getIpcClient();
  const [servers, setServers] = useState<McpServerDetails[]>([]);
  const [selectedServerName, setSelectedServerName] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<string>("resources");
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Selected resource state
  const [selectedResource, setSelectedResource] = useState<McpResource | null>(null);
  const [resourceLoading, setResourceLoading] = useState<boolean>(false);
  const [resourceFilter, setResourceFilter] = useState<string>("");

  // Prompt template execution state
  const [promptArgs, setPromptArgs] = useState<Record<string, Record<string, string>>>({});
  const [promptResult, setPromptResult] = useState<string | null>(null);

  const loadServers = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await client.getMcpServers();
      setServers(list);
      if (list.length > 0 && !selectedServerName) {
        setSelectedServerName(list[0].name);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load MCP servers");
    } finally {
      setLoading(false);
    }
  }, [client, selectedServerName]);

  useEffect(() => {
    void loadServers();
  }, [loadServers]);

  const selectedServer = servers.find((s) => s.name === selectedServerName) ?? servers[0];

  const handleSelectResource = async (res: McpResource) => {
    if (!selectedServer) return;
    setResourceLoading(true);
    try {
      const full = await client.readMcpResource(selectedServer.name, res.uri);
      setSelectedResource(full);
    } catch (e) {
      setSelectedResource({
        ...res,
        text: `Error reading resource: ${e instanceof Error ? e.message : "Unknown error"}`,
      });
    } finally {
      setResourceLoading(false);
    }
  };

  const handleRunPrompt = async (prompt: McpPromptTemplate) => {
    if (!selectedServer) return;
    const args = promptArgs[prompt.name] ?? {};
    try {
      const result = await client.getMcpPrompt(selectedServer.name, prompt.name, args);
      const formatted = result.messages.map((m) => m.content).join("\n\n");
      setPromptResult(formatted);
      if (onInjectPrompt) {
        onInjectPrompt(formatted);
      }
    } catch (e) {
      setPromptResult(`Error rendering template: ${e instanceof Error ? e.message : "Unknown error"}`);
    }
  };

  const filteredResources = (selectedServer?.resources ?? []).filter(
    (r) =>
      r.name.toLowerCase().includes(resourceFilter.toLowerCase()) ||
      r.uri.toLowerCase().includes(resourceFilter.toLowerCase()) ||
      (r.mimeType ?? "").toLowerCase().includes(resourceFilter.toLowerCase()),
  );

  return (
    <div className="mcp-explorer" data-testid="mcp-explorer">
      <div className="sp-head">
        <div className="sp-headrow">
          <Text variant="label" weight="semibold">
            Model Context Protocol (MCP) Live Explorer
          </Text>
          <Badge tone="accent">v2024-11-05</Badge>
          <Button size="sm" variant="ghost" onClick={() => void loadServers()}>
            Refresh
          </Button>
        </div>
        <Text variant="micro" tone="dim">
          Inspect live MCP servers, stream URI resources, invoke prompt templates, and inspect tool schemas.
        </Text>
      </div>

      {loading ? (
        <Card variant="default" padding="lg" className="sp-center">
          <Spinner size={18} />
          <Text variant="micro" tone="dim">
            Discovering connected MCP servers…
          </Text>
        </Card>
      ) : error ? (
        <Card variant="default" padding="md" className="sp-err">
          <Text variant="micro" tone="danger">
            {error}
          </Text>
        </Card>
      ) : (
        <div className="mcp-explorer__grid">
          {/* Sidebar with MCP Servers */}
          <div className="mcp-servers-sidebar">
            <Text variant="micro" tone="muted" uppercase weight="semibold">
              Connected Servers ({servers.length})
            </Text>
            {servers.map((s) => (
              <div
                key={s.name}
                className={`mcp-server-card ${selectedServer?.name === s.name ? "mcp-server-card--active" : ""}`}
                onClick={() => {
                  setSelectedServerName(s.name);
                  setSelectedResource(null);
                }}
              >
                <div className="mcp-server-card__header">
                  <Text variant="label" weight="medium">
                    {s.name}
                  </Text>
                  <Badge tone={s.status === "connected" ? "success" : "neutral"} dot>
                    {s.latencyMs != null ? `${s.latencyMs}ms` : s.status}
                  </Badge>
                </div>
                <Text variant="micro" tone="dim" mono className="sp-ellipsis">
                  {s.command} {s.args?.join(" ") ?? ""}
                </Text>
                <div className="mcp-server-card__meta">
                  <Badge tone="neutral">{s.tools?.length ?? 0} tools</Badge>
                  <Badge tone="neutral">{s.resources?.length ?? 0} resources</Badge>
                  <Badge tone="neutral">{s.prompts?.length ?? 0} prompts</Badge>
                </div>
              </div>
            ))}
          </div>

          {/* Main Detail & Inspection Workspace */}
          {selectedServer ? (
            <div className="mcp-detail-panel">
              <div className="mcp-detail-header">
                <div>
                  <div className="mcp-detail-title">
                    <Text variant="label" weight="bold">
                      {selectedServer.name}
                    </Text>
                    <Badge tone="success" dot>
                      Live Connected ({selectedServer.latencyMs ?? 0}ms)
                    </Badge>
                  </div>
                  <div className="mcp-capabilities-row">
                    {selectedServer.capabilities?.tools && <Badge tone="accent">Tools Enabled</Badge>}
                    {selectedServer.capabilities?.resources && (
                      <Badge tone="neutral">Resource Streaming</Badge>
                    )}
                    {selectedServer.capabilities?.prompts && <Badge tone="neutral">Prompt Templates</Badge>}
                  </div>
                </div>
              </div>

              <Tabs
                variant="pill"
                items={[
                  { id: "resources", label: `Resources (${selectedServer.resources?.length ?? 0})` },
                  { id: "prompts", label: `Prompts (${selectedServer.prompts?.length ?? 0})` },
                  { id: "tools", label: `Tool Schemas (${selectedServer.tools?.length ?? 0})` },
                ]}
                activeId={activeTab}
                onChange={setActiveTab}
              />

              {/* Resources Explorer Tab */}
              {activeTab === "resources" && (
                <div className="mcp-tab-content">
                  <Input
                    label="Filter Resources"
                    placeholder="Search by URI, name, or MIME type..."
                    value={resourceFilter}
                    onChange={(e) => setResourceFilter(e.target.value)}
                  />

                  {filteredResources.length === 0 ? (
                    <Text variant="body" tone="dim">
                      No resources declared on this MCP server.
                    </Text>
                  ) : (
                    filteredResources.map((res) => (
                      <div
                        key={res.uri}
                        className={`mcp-resource-item ${
                          selectedResource?.uri === res.uri ? "mcp-resource-item--active" : ""
                        }`}
                        onClick={() => void handleSelectResource(res)}
                      >
                        <div className="sp-headrow">
                          <Text variant="label" weight="medium">
                            {res.name}
                          </Text>
                          <Badge tone="accent">{res.mimeType ?? "text/plain"}</Badge>
                        </div>
                        <Text variant="micro" tone="dim" mono>
                          {res.uri}
                        </Text>
                        {res.description && (
                          <Text variant="micro" tone="muted">
                            {res.description}
                          </Text>
                        )}
                      </div>
                    ))
                  )}

                  {/* Live Streamed Resource Content View */}
                  {selectedResource && (
                    <div className="mcp-resource-viewer" data-testid="mcp-resource-viewer">
                      <div className="sp-headrow">
                        <Text variant="label" weight="semibold">
                          Streaming: {selectedResource.name}
                        </Text>
                        <Badge tone="neutral">
                          {selectedResource.size ?? selectedResource.text?.length ?? 0} bytes
                        </Badge>
                      </div>
                      {resourceLoading ? (
                        <Spinner size={14} />
                      ) : (
                        <pre className="mcp-resource-viewer__code">
                          {selectedResource.text ?? "No content"}
                        </pre>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Prompts Tab */}
              {activeTab === "prompts" && (
                <div className="mcp-tab-content">
                  {(selectedServer.prompts ?? []).length === 0 ? (
                    <Text variant="body" tone="dim">
                      No prompt templates defined on this server.
                    </Text>
                  ) : (
                    selectedServer.prompts.map((prompt) => (
                      <div key={prompt.name} className="mcp-prompt-card">
                        <div className="sp-headrow">
                          <Text variant="label" weight="semibold">
                            {prompt.name}
                          </Text>
                          <Button size="sm" onClick={() => void handleRunPrompt(prompt)}>
                            Synthesize & Inject
                          </Button>
                        </div>
                        {prompt.description && (
                          <Text variant="micro" tone="muted">
                            {prompt.description}
                          </Text>
                        )}

                        {prompt.arguments && prompt.arguments.length > 0 && (
                          <div className="mcp-prompt-args">
                            {prompt.arguments.map((arg) => (
                              <Input
                                key={arg.name}
                                label={`${arg.name}${arg.required ? " *" : ""}`}
                                placeholder={arg.description ?? `Enter ${arg.name}`}
                                value={promptArgs[prompt.name]?.[arg.name] ?? ""}
                                onChange={(e) =>
                                  setPromptArgs((prev) => ({
                                    ...prev,
                                    [prompt.name]: {
                                      ...(prev[prompt.name] ?? {}),
                                      [arg.name]: e.target.value,
                                    },
                                  }))
                                }
                              />
                            ))}
                          </div>
                        )}
                      </div>
                    ))
                  )}

                  {promptResult && (
                    <div className="mcp-resource-viewer">
                      <Text variant="label" weight="semibold">
                        Prompt Output Preview
                      </Text>
                      <pre className="mcp-resource-viewer__code">{promptResult}</pre>
                    </div>
                  )}
                </div>
              )}

              {/* Tools Tab */}
              {activeTab === "tools" && (
                <div className="mcp-tab-content">
                  {(selectedServer.tools ?? []).length === 0 ? (
                    <Text variant="body" tone="dim">
                      No tools exposed by this server.
                    </Text>
                  ) : (
                    selectedServer.tools.map((tool) => (
                      <div key={tool.name} className="mcp-prompt-card">
                        <div className="sp-headrow">
                          <Text variant="label" weight="semibold" mono>
                            {tool.name}
                          </Text>
                          <Badge tone="neutral">JSON-RPC</Badge>
                        </div>
                        {tool.description && (
                          <Text variant="micro" tone="muted">
                            {tool.description}
                          </Text>
                        )}
                        {tool.inputSchema && (
                          <pre className="mcp-resource-viewer__code">
                            {JSON.stringify(tool.inputSchema, null, 2)}
                          </pre>
                        )}
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
