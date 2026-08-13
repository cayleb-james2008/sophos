// ExtensionsPanel — the extensions management surface. Shows the live
// daemon-discovered extensions from the resource snapshot, the configured
// extensions persisted in settings.json, and an install/uninstall form.
//
// Each configured extension renders as an expandable row that surfaces the
// tools and slash commands it registers, so the panel is a real inventory of
// what an extension contributes — not just a name + path list.
//
// Note: The Settings type in the IPC contract doesn't include extension
// fields. We use a local ExtendedSettings interface for the UI state, and
// cast through Record<string, unknown> when calling setSettings (which accepts
// arbitrary keys per the IPC contract).

import { useCallback, useEffect, useState } from "react";
import { Text, Card, Button, Input, Spinner, Badge } from "../../design";
import { useIpc } from "../../ipc/client";
import type { ExtensionInfo, RuntimeInfo, Settings } from "../../ipc/contract";
import { RefreshIcon, PlugIcon, XIcon } from "../sessions/icons";

interface ExtendedSettings extends Settings {
  extensions?: Array<{ name: string; path: string; enabled: boolean }>;
}

/** A configured extension merged with its rich detail (tools + slash commands). */
interface ConfiguredExtension {
  name: string;
  path: string;
  enabled: boolean;
  tools: ExtensionInfo["tools"];
  slashCommands: ExtensionInfo["slashCommands"];
}

export function ExtensionsPanel() {
  const ipc = useIpc();
  const [loading, setLoading] = useState(true);
  const [settings, setSettings] = useState<ExtendedSettings>({});
  const [runtime, setRuntime] = useState<RuntimeInfo>();
  const [details, setDetails] = useState<ExtensionInfo[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [installPath, setInstallPath] = useState("");
  const [actionError, setActionError] = useState<string>();
  const [actionMessage, setActionMessage] = useState<string>();

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [s, liveRuntime] = await Promise.all([ipc.getSettings(), ipc.getRuntimeInfo()]);
      setSettings(s as ExtendedSettings);
      setRuntime(liveRuntime);
      // Rich per-extension detail (tools + slash commands). Falls back to an
      // empty list when getExtensions is unavailable, so the panel still shows
      // name + path + toggle from the configured settings.
      try {
        setDetails(await ipc.getExtensions());
      } catch {
        setDetails([]);
      }
    } finally {
      setLoading(false);
    }
  }, [ipc]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const configured = settings.extensions ?? [];

  // Merge configured extensions with their rich detail, keyed by path (falling
  // back to name when paths don't line up). Extensions configured but missing
  // from getExtensions still render with empty tools/commands.
  const merged: ConfiguredExtension[] = configured.map((e) => {
    const detail = details.find((d) => d.path === e.path || d.name === e.name);
    return {
      name: e.name,
      path: e.path,
      enabled: e.enabled,
      tools: detail?.tools ?? [],
      slashCommands: detail?.slashCommands ?? [],
    };
  });

  const toggleExpanded = (path: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  };

  const toggleExtension = async (idx: number, enabled: boolean) => {
    const next = configured.map((e, i) => (i === idx ? { ...e, enabled } : e));
    await ipc.setSettings({ ...settings, extensions: next } as Record<string, unknown>);
    void refresh();
  };

  const removeExtension = async (path: string) => {
    setActionError(undefined);
    setActionMessage(undefined);
    try {
      await ipc.removeExtension(path);
      setActionMessage(`Removed extension ${path}.`);
      await refresh();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Could not remove extension");
    }
  };

  const installExtension = async () => {
    if (!installPath.trim()) return;
    setActionError(undefined);
    setActionMessage(undefined);
    try {
      await ipc.installExtension(installPath.trim());
      setInstallPath("");
      setActionMessage(`Installed extension ${installPath.trim()}.`);
      await refresh();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Could not install extension");
    }
  };

  return (
    <div className="gp-form">
      {loading ? (
        <div className="ap-loading">
          <Spinner size={22} />
        </div>
      ) : (
        <>
          <Card variant="raised" padding="lg" style={{ display: "flex", flexDirection: "column", gap: 22 }}>
            <div className="ep-head">
              <div className="sp-headrow">
                <span className="sp-icon">
                  <PlugIcon size={16} />
                </span>
                <Text variant="label" weight="semibold">
                  Extensions
                </Text>
              </div>
              <Button variant="ghost" size="sm" icon={<RefreshIcon size={13} />} onClick={refresh}>
                Reload
              </Button>
            </div>

            <Text variant="body" tone="muted">
              Extension discovery is managed by the daemon. This panel reads the live resource snapshot,
              so the list below is what this session can actually load — not a browser-side catalog.
              Configured extension paths remain editable here and are applied on the next daemon session.
              Expand an extension to see the tools and slash commands it registers.
            </Text>
          </Card>

          <Card variant="raised" padding="lg" style={{ display: "flex", flexDirection: "column", gap: 22 }}>
            <div className="sp-headrow">
              <Text variant="label" weight="semibold">Live extensions</Text>
              <Text variant="micro" tone="dim" mono>{runtime?.extensions.length ?? 0}</Text>
              <Badge tone="info">live daemon</Badge>
            </div>
            {runtime?.extensions.length ? (
              <div className="sp-list">
                {runtime.extensions.map((path) => (
                  <div key={path} className="ep-liverow">
                    <Text variant="micro" tone="dim" mono className="ap-cwd">{path}</Text>
                  </div>
                ))}
              </div>
            ) : (
              <Text variant="body" tone="dim">The live daemon reported no loaded extensions for this session.</Text>
            )}
          </Card>

          <Card variant="raised" padding="lg" style={{ display: "flex", flexDirection: "column", gap: 22 }}>
            <div className="sp-headrow">
              <Text variant="label" weight="semibold">Configured extensions</Text>
              <Text variant="micro" tone="dim" mono>{configured.length}</Text>
            </div>
            {configured.length === 0 ? (
              <Text variant="body" tone="dim">No extensions configured. Install an extension below.</Text>
            ) : (
              <div className="sp-list">
                {merged.map((e, idx) => {
                  const isOpen = expanded.has(e.path);
                  return (
                    <div key={e.path} className="ep-card">
                      <div className="sp-row">
                        <div className="sp-rowmain">
                          <div className="sp-headrow--sm">
                            <Text variant="label" weight="medium" className="sp-ellipsis">
                              {e.name}
                            </Text>
                            <Badge tone={e.enabled ? "success" : "neutral"} dot>
                              {e.enabled ? "Enabled" : "Disabled"}
                            </Badge>
                          </div>
                          <Text variant="micro" tone="dim" mono className="sp-ellipsis">
                            {e.path}
                          </Text>
                        </div>
                        <label className="sp-check">
                          <input
                            type="checkbox"
                            checked={e.enabled}
                            onChange={(ev) => void toggleExtension(idx, ev.target.checked)}
                            className="sp-checkbox"
                          />
                          <Text variant="micro" tone="muted">Enable</Text>
                        </label>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => toggleExpanded(e.path)}
                          aria-label={`Toggle details for ${e.name}`}
                          aria-expanded={isOpen}
                        >
                          {isOpen ? "Hide" : "Details"}
                        </Button>
                        <Button variant="ghost" size="sm" icon={<XIcon size={13} />} onClick={() => void removeExtension(e.path)} aria-label={`Remove ${e.name}`} />
                      </div>
                      {isOpen ? (
                        <div className="ep-detail">
                          <div className="ep-detailcol">
                            <Text variant="micro" tone="dim" className="ep-detailhead">Tools</Text>
                            {e.tools.length ? (
                              <div className="ep-itemlist">
                                {e.tools.map((t) => (
                                  <div key={t.name} className="ep-item">
                                    <Text variant="micro" mono className="ep-itemname">{t.name}</Text>
                                    {t.description ? <Text variant="micro" tone="dim">{t.description}</Text> : null}
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <Text variant="micro" tone="dim">No tools registered</Text>
                            )}
                          </div>
                          <div className="ep-detailcol">
                            <Text variant="micro" tone="dim" className="ep-detailhead">Slash commands</Text>
                            {e.slashCommands.length ? (
                              <div className="ep-itemlist">
                                {e.slashCommands.map((c) => (
                                  <div key={c.name} className="ep-item">
                                    <Text variant="micro" mono className="ep-itemname">/{c.name}</Text>
                                    {c.description ? <Text variant="micro" tone="dim">{c.description}</Text> : null}
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <Text variant="micro" tone="dim">No slash commands registered</Text>
                            )}
                          </div>
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            )}
          </Card>

          <Card variant="raised" padding="lg" style={{ display: "flex", flexDirection: "column", gap: 22 }}>
            <div className="sp-headrow">
              <Text variant="label" weight="semibold">Install an extension</Text>
            </div>
            <Text variant="body" tone="muted">Add an extension directory or file path. The daemon reloads and picks it up on the next session.</Text>
            {actionError ? <Text variant="micro" tone="danger">{actionError}</Text> : null}
            {actionMessage ? <Text variant="micro" tone="success">{actionMessage}</Text> : null}
            <div className="ep-installrow">
              <div className="ep-installfield">
                <Input label="Extension path" value={installPath} onChange={(e) => setInstallPath(e.target.value)} placeholder="C:\\work\\extensions\\my-extension" />
              </div>
              <Button variant="primary" onClick={() => void installExtension()} disabled={!installPath.trim()}>Install</Button>
            </div>
          </Card>

          <Card variant="raised" padding="lg" style={{ display: "flex", flexDirection: "column", gap: 22 }}>
            <div className="ep-disc">
              <Text variant="micro" tone="dim" mono className="ep-disclabel">
                Discovery locations
              </Text>
              <Text variant="micro" tone="dim">
                Extensions are discovered from:
                <br />
                • Global: <Text mono>~/.prime/agent/extensions/</Text>
                <br />
                • Project: <Text mono>.prime/agent/extensions/</Text>
                <br />
                • Settings: <Text mono>{"extensions: [{ name, path, enabled }]"}</Text>
              </Text>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
