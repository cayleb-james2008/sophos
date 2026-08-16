// StudioPanel — the Profile Studio drawer (v0.7.1).
//
// The DeepSeek Harness Creator mode made visual: inspect the LIVE runtime
// through the Code Mode registry's sources (built-in / extension / MCP /
// skill), compose a custom agent profile, and test it in memory. Every edit
// dispatches to the shared profile state, so the running app follows the
// draft immediately (hot reload): the header chip, composer hint, and (in
// demo mode) the simulated responses all read the effective profile. Save
// persists to settings, Discard drops the draft, Delete removes the profile.
//
// The registry composes from the same deterministic assembleRegistry the Code
// Mode SDK uses — no new IPC. A source that is absent (call failed / not
// configured / nothing discovered) degrades honestly: the group renders its
// count and an explicit note instead of pretending.

import { useCallback, useEffect, useMemo, useState } from "react";
import { Text, Button, IconButton, Badge, Spinner } from "../../design";
import { useIpc, type IpcClient } from "../../ipc/client";
import type { McpTestResult, Settings } from "../../ipc/contract";
import { useProfile } from "../profiles/profiles";
import { assembleRegistry, countByCategory, type McpServerConfig, type ToolCategory, type ToolRegistryEntry } from "../code/toolRegistry";
import { isCustomProfileUsable, studioCompositionSummary, workingStyleToText } from "./editor";
import { customDemoFlavor } from "./store";
import "./studio.css";

interface RegistryState {
  entries: ToolRegistryEntry[];
  counts: Record<ToolCategory, number>;
  /** Did each source actually respond? Absent sources degrade with a note. */
  availability: { builtin: true; extension: boolean; mcp: boolean; skill: boolean };
  mcpConfigured: number;
}

function readMcpServers(settings: Settings | null): McpServerConfig[] {
  const raw = (settings as Settings & { mcpServers?: McpServerConfig[] } | null)?.mcpServers;
  if (!Array.isArray(raw)) return [];
  return raw.filter((s): s is McpServerConfig => !!s && typeof s.name === "string" && typeof s.command === "string");
}

/** Load the live registry + per-source availability. Reuses the Code Mode
 * registry's deterministic assembly; failures degrade per source. */
async function loadStudioRegistry(ipc: IpcClient): Promise<RegistryState> {
  const [runtime, extensions, settings] = await Promise.all([
    ipc.getRuntimeInfo().catch(() => null),
    typeof ipc.getExtensions === "function" ? ipc.getExtensions().catch(() => null) : Promise.resolve(null),
    typeof ipc.getSettings === "function" ? ipc.getSettings().catch(() => null) : Promise.resolve(null),
  ]);
  const enabled = readMcpServers(settings).filter((s) => s.enabled);
  const mcpResults: Record<string, McpTestResult> = {};
  await Promise.all(
    enabled.map(async (server) => {
      try {
        mcpResults[server.name] = await ipc.testMcpServer(server.name, server.command, server.args);
      } catch {
        mcpResults[server.name] = { serverName: server.name, connected: false };
      }
    }),
  );
  const entries = assembleRegistry({ runtime, extensions, mcpServers: enabled, mcpResults });
  return {
    entries,
    counts: countByCategory(entries),
    availability: {
      builtin: true,
      extension: extensions !== null,
      mcp: enabled.length > 0 && Object.values(mcpResults).some((r) => r.connected),
      skill: runtime !== null && (runtime.skills?.length ?? 0) > 0,
    },
    mcpConfigured: enabled.length,
  };
}

const CATEGORY_META: Array<{ category: ToolCategory; label: string; absentNote: string }> = [
  { category: "builtin", label: "Built-in", absentNote: "" },
  { category: "extension", label: "Extension", absentNote: "Extension source unavailable — no extension tools to compose." },
  { category: "mcp", label: "MCP", absentNote: "No connected MCP server — configure one in Settings → Advanced → MCP servers." },
  { category: "skill", label: "Skill", absentNote: "No skills discovered by the live runtime — skill tools appear here when the daemon reports them." },
];

function groupLabel(entry: ToolRegistryEntry): string {
  switch (entry.category) {
    case "extension": return `extension${entry.source ? ` · ${entry.source}` : ""}`;
    case "mcp": return `mcp${entry.source ? ` · ${entry.source}` : ""}`;
    case "skill": return `skill${entry.source ? ` · ${entry.source}` : ""}`;
    default: return "built-in";
  }
}

export function StudioPanel() {
  const {
    studioOpen,
    studioDraft,
    studioEditingId,
    studioDispatch,
    closeStudio,
    saveDraft,
    deleteCustomProfile,
  } = useProfile();
  const ipc = useIpc();

  const [registry, setRegistry] = useState<RegistryState | null>(null);
  const [registryError, setRegistryError] = useState<string | null>(null);
  const [workingText, setWorkingText] = useState("");
  const [confirmDraft, setConfirmDraft] = useState("");

  // Load the live registry whenever the studio opens.
  useEffect(() => {
    if (!studioOpen) return;
    let mounted = true;
    setRegistry(null);
    setRegistryError(null);
    loadStudioRegistry(ipc)
      .then((r) => {
        if (mounted) setRegistry(r);
      })
      .catch((err) => {
        if (mounted) setRegistryError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      mounted = false;
    };
  }, [studioOpen, ipc]);

  // Sync the working-style textarea from the draft ONLY when the studio opens
  // (the textarea is the sole editor of workingStyle, so re-syncing on every
  // chip change would rewrite the user's in-progress text mid-typing).
  useEffect(() => {
    if (!studioOpen || !studioDraft) return;
    setWorkingText(workingStyleToText(studioDraft.workingStyle));
  }, [studioOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  const draft = studioDraft;
  const usable = draft ? isCustomProfileUsable(draft) : false;

  const groups = useMemo(() => {
    if (!registry) return null;
    const map = new Map<ToolCategory, ToolRegistryEntry[]>();
    for (const entry of registry.entries) {
      const list = map.get(entry.category) ?? [];
      list.push(entry);
      map.set(entry.category, list);
    }
    return map;
  }, [registry]);

  const discoveredSkills = useMemo(() => (groups ? (groups.get("skill") ?? []).map((e) => e.name) : []), [groups]);

  const handleSave = useCallback(() => {
    void saveDraft();
  }, [saveDraft]);

  const handleDelete = useCallback(() => {
    if (studioEditingId) void deleteCustomProfile(studioEditingId);
  }, [studioEditingId, deleteCustomProfile]);

  if (!studioOpen) return null;

  const modeLabel = draft ? draft.mode[0].toUpperCase() + draft.mode.slice(1) : "";

  return (
    <div className="st" data-testid="profile-studio">
      <aside className="st__drawer" role="dialog" aria-label="Profile Studio" aria-modal="false">
        <header className="st__header">
          <div className="st__heading">
            <Text variant="micro" tone="dim" mono uppercase>Profile Studio</Text>
            <Text variant="subtitle" weight="semibold">
              {studioEditingId ? "Edit custom profile" : "New custom profile"}
            </Text>
          </div>
          <div className="st__header-actions">
            <Badge tone={usable ? "success" : "warning"} dot>{usable ? "live" : "degrades to Standard"}</Badge>
            <IconButton title="Close studio (Discard)" onClick={closeStudio} size="sm">✕</IconButton>
          </div>
        </header>

        <div className="st__body">
          {/* --- Hot-reload banner --- */}
          <div className="st__banner">
            <Text variant="micro" tone="dim">
              Hot reload — the header chip, composer hint, and demo responses follow this draft right now. Save persists; Discard reverts.
            </Text>
          </div>

          {/* --- Identity --- */}
          <section className="st__section">
            <div className="st__section-head">
              <Text variant="micro" tone="dim" mono uppercase>Identity</Text>
            </div>
            <label className="st__field">
              <span className="st__label">Name</span>
              <input
                className="st__input"
                value={draft?.name ?? ""}
                onChange={(e) => studioDispatch({ type: "name", value: e.target.value })}
                placeholder="My Builder"
                aria-label="Profile name"
              />
            </label>
            <label className="st__field">
              <span className="st__label">Tagline</span>
              <input
                className="st__input"
                value={draft?.tagline ?? ""}
                onChange={(e) => studioDispatch({ type: "tagline", value: e.target.value })}
                placeholder="One line about what this profile is for"
                aria-label="Profile tagline"
              />
            </label>
            <label className="st__field">
              <span className="st__label">Description</span>
              <textarea
                className="st__textarea"
                rows={3}
                value={draft?.description ?? ""}
                onChange={(e) => studioDispatch({ type: "description", value: e.target.value })}
                placeholder="What should this profile be good at?"
                aria-label="Profile description"
              />
            </label>
            <label className="st__field">
              <span className="st__label">Working style — one chip per line</span>
              <textarea
                className="st__textarea"
                rows={3}
                value={workingText}
                onChange={(e) => {
                  setWorkingText(e.target.value);
                  studioDispatch({ type: "workingStyleText", value: e.target.value });
                }}
                placeholder={"Goal first\nVerify with real runs\nPlain-English reports"}
                aria-label="Working style"
              />
            </label>
            {draft && draft.workingStyle.length > 0 ? (
              <div className="st__chips">
                {draft.workingStyle.map((chip) => (
                  <span key={chip} className="st__chip">{chip}</span>
                ))}
              </div>
            ) : null}
          </section>

          {/* --- Base mode --- */}
          <section className="st__section">
            <div className="st__section-head">
              <Text variant="micro" tone="dim" mono uppercase>Base mode</Text>
            </div>
            <div className="st__modes">
              {(["standard", "minimal", "creator", "code"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  className={`st__mode${draft?.mode === m ? " st__mode--active" : ""}`}
                  aria-pressed={draft?.mode === m}
                  onClick={() => studioDispatch({ type: "mode", value: m })}
                >
                  {m[0].toUpperCase() + m.slice(1)}
                </button>
              ))}
            </div>
            <Text variant="micro" tone="muted">
              Sets the profile's runtime mode and demo behavior; the toggles below define exactly which tools and skills it composes.
            </Text>
          </section>

          {/* --- Tools from the LIVE registry --- */}
          <section className="st__section">
            <div className="st__section-head">
              <Text variant="micro" tone="dim" mono uppercase>Tools — live registry</Text>
              <Text variant="micro" tone="muted">
                {registry ? `${registry.entries.length} tools found on this machine` : "loading…"}
              </Text>
            </div>
            {registryError ? <Text variant="micro" tone="danger">{registryError}</Text> : null}
            {!registry ? (
              <div className="st__loading" aria-busy="true" aria-live="polite"><Spinner size={14} /></div>
            ) : (
              CATEGORY_META.map(({ category, label, absentNote }) => {
                const available = registry.availability[category];
                const entries = groups?.get(category) ?? [];
                const active = draft?.tools.filter((t) => entries.some((e) => e.name === t)) ?? [];
                return (
                  <div key={category} className="st__group">
                    <div className="st__group-head">
                      <Text variant="label" tone="dim">{label}</Text>
                      <span className="st__group-count">{active.length} of {entries.length} on</span>
                    </div>
                    {!available ? (
                      <Text variant="micro" tone="muted" className="st__absent">{absentNote}</Text>
                    ) : entries.length === 0 ? (
                      <Text variant="micro" tone="muted" className="st__absent">No {label.toLowerCase()} tools found.</Text>
                    ) : (
                      <div className="st__tools">
                        {entries.map((entry) => {
                          const on = draft?.tools.includes(entry.name) ?? false;
                          return (
                            <button
                              key={`${entry.category}:${entry.name}`}
                              type="button"
                              role="switch"
                              aria-checked={on}
                              className={`st__tool${on ? " st__tool--on" : ""}`}
                              onClick={() => studioDispatch({ type: "toggleTool", name: entry.name })}
                              title={entry.description ?? "No description"}
                            >
                              <span className="st__tool-toggle" aria-hidden="true" />
                              <span className="st__tool-name">{entry.name}</span>
                              <span className="st__tool-src">{groupLabel(entry)}</span>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </section>

          {/* --- Skills --- */}
          <section className="st__section">
            <div className="st__section-head">
              <Text variant="micro" tone="dim" mono uppercase>Skills</Text>
              <Text variant="micro" tone="muted">invoked in this profile</Text>
            </div>
            {!registry ? (
              <div className="st__loading" aria-busy="true"><Spinner size={14} /></div>
            ) : discoveredSkills.length === 0 ? (
              <Text variant="micro" tone="muted" className="st__absent">
                No skills discovered by the live runtime — skills appear here when the daemon reports them.
              </Text>
            ) : (
              <div className="st__tools">
                <button
                  type="button"
                  role="switch"
                  aria-checked={draft?.skills.includes("All enabled skills") ?? false}
                  className={`st__tool${draft?.skills.includes("All enabled skills") ? " st__tool--on" : ""}`}
                  onClick={() => studioDispatch({ type: "toggleSkill", name: "All enabled skills" })}
                >
                  <span className="st__tool-toggle" aria-hidden="true" />
                  <span className="st__tool-name">All enabled skills</span>
                  <span className="st__tool-src">master</span>
                </button>
                {discoveredSkills.map((name) => {
                  const on = draft?.skills.includes(name) ?? false;
                  return (
                    <button
                      key={name}
                      type="button"
                      role="switch"
                      aria-checked={on}
                      className={`st__tool${on ? " st__tool--on" : ""}`}
                      onClick={() => studioDispatch({ type: "toggleSkill", name })}
                    >
                      <span className="st__tool-toggle" aria-hidden="true" />
                      <span className="st__tool-name">{name}</span>
                      <span className="st__tool-src">skill</span>
                    </button>
                  );
                })}
              </div>
            )}
          </section>

          {/* --- Safety --- */}
          <section className="st__section">
            <div className="st__section-head">
              <Text variant="micro" tone="dim" mono uppercase>Safety posture</Text>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={draft?.safety.autoApprove ?? false}
              className={`st__safety${draft?.safety.autoApprove ? " st__safety--on" : ""}`}
              onClick={() => studioDispatch({ type: "setAutoApprove", value: !(draft?.safety.autoApprove ?? false) })}
            >
              <span className="st__tool-toggle" aria-hidden="true" />
              <span className="st__safety-label">Auto-approve safe tools</span>
              <span className="st__safety-note">destructive actions still ask</span>
            </button>
            <div className="st__confirm">
              <Text variant="micro" tone="muted">Confirm list</Text>
              <div className="st__confirm-row">
                <input
                  className="st__input"
                  value={confirmDraft}
                  onChange={(e) => setConfirmDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      studioDispatch({ type: "confirmAdd", value: confirmDraft });
                      setConfirmDraft("");
                    }
                  }}
                  placeholder="e.g. Destructive shell"
                  aria-label="Add confirm entry"
                />
                <Button
                  variant="outline"
                  size="sm"
                  type="button"
                  onClick={() => {
                    studioDispatch({ type: "confirmAdd", value: confirmDraft });
                    setConfirmDraft("");
                  }}
                >
                  Add
                </Button>
              </div>
              {draft && draft.safety.confirm.length > 0 ? (
                <div className="st__chips">
                  {draft.safety.confirm.map((c) => (
                    <span key={c} className="st__chip st__chip--confirm">
                      {c}
                      <button
                        type="button"
                        className="st__chip-x"
                        aria-label={`Remove ${c}`}
                        onClick={() => studioDispatch({ type: "confirmRemove", value: c })}
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              ) : null}
            </div>
          </section>

          {/* --- Live composition summary + preview --- */}
          <section className="st__section">
            <div className="st__section-head">
              <Text variant="micro" tone="dim" mono uppercase>Live composition</Text>
            </div>
            {draft ? (
              <>
                <div className="st__summary" data-testid="studio-composition-summary">
                  <Text variant="micro" tone="muted">{studioCompositionSummary(draft)}</Text>
                </div>
                <div className="st__preview">
                  <Text variant="micro" tone="dim" mono uppercase>What the app shows right now</Text>
                  <div className="st__preview-row"><span className="st__preview-k">Header chip</span><span className="st__preview-v">{draft.name || "Standard"} · {modeLabel}</span></div>
                  <div className="st__preview-row"><span className="st__preview-k">Composer hint</span><span className="st__preview-v">{draft.name || "Standard"} profile — {draft.tagline || "no tagline"}</span></div>
                  <div className="st__preview-row"><span className="st__preview-k">Demo response</span><span className="st__preview-v st__preview-v--muted">{customDemoFlavor({ name: draft.name, tagline: draft.tagline, workingStyle: draft.workingStyle }) || "no flavor (Standard)"}</span></div>
                </div>
              </>
            ) : null}
          </section>
        </div>

        <footer className="st__footer">
          <div className="st__footer-left">
            {!usable ? (
              <Text variant="micro" tone="warning">Add a name and at least one tool to save — an unusable profile degrades to Standard defaults.</Text>
            ) : null}
            {studioEditingId ? (
              <Button variant="danger" size="sm" type="button" onClick={handleDelete} className="st__delete">
                Delete
              </Button>
            ) : null}
          </div>
          <div className="st__footer-actions">
            <Button variant="outline" type="button" onClick={closeStudio}>Discard</Button>
            <Button variant="primary" type="button" onClick={handleSave} disabled={!usable} data-testid="studio-save">
              {studioEditingId ? "Save changes" : "Create profile"}
            </Button>
          </div>
        </footer>
      </aside>
    </div>
  );
}
