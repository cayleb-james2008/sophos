// SkillsPanel — the skills management surface. Shows skill discovery status
// and manages skill paths in settings. The daemon handles actual skill
// discovery; this panel surfaces what's in settings.json and provides
// a UI for configuring skill discovery paths.
//
// Note: The Settings type in the IPC contract doesn't include skill-related
// fields. We use a local ExtendedSettings interface for the UI state, and
// cast through Record<string, unknown> when calling setSettings (which accepts
// arbitrary keys per the IPC contract).

import { useCallback, useEffect, useState } from "react";
import { tokens } from "../../design/tokens";
import { Text, Card, Button, Input, Spinner, TextArea, Badge } from "../../design";
import { useIpc } from "../../ipc/client";
import type { RuntimeInfo, Settings } from "../../ipc/contract";
import { RefreshIcon, BookIcon, CheckIcon, XIcon, SparkIcon } from "../sessions/icons";

interface ExtendedSettings extends Settings {
  enableBuiltinSkills?: boolean;
  enableSkillCommands?: boolean;
  bundledSkills?: { websearch?: boolean };
  skills?: string[];
  packages?: Array<string | { source: string }>;
  disabledSkills?: string[];
}

export function SkillsPanel() {
  const ipc = useIpc();
  const [loading, setLoading] = useState(true);
  const [settings, setSettings] = useState<ExtendedSettings>({});
  const [runtime, setRuntime] = useState<RuntimeInfo>();
  const [skillPathsDraft, setSkillPathsDraft] = useState<string[]>([]);
  const [newSkillPath, setNewSkillPath] = useState("");
  const [saving, setSaving] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createDescription, setCreateDescription] = useState("");
  const [createContent, setCreateContent] = useState("");
  const [installPath, setInstallPath] = useState("");
  const [actionError, setActionError] = useState<string>();
  const [actionMessage, setActionMessage] = useState<string>();
  const [lastCreatedSkill, setLastCreatedSkill] = useState<string>();

  const refresh = useCallback(async () => {
    setLoading(true);
    // A manual reload clears the transient "Just installed" highlight — the
    // badge is meant to call out the skill created in this session, not to
    // persist across refreshes.
    setLastCreatedSkill(undefined);
    try {
      const [s, liveRuntime] = await Promise.all([ipc.getSettings(), ipc.getRuntimeInfo()]);
      const ext = s as ExtendedSettings;
      setSettings(ext);
      setRuntime(liveRuntime);
      setSkillPathsDraft((ext.skills as string[]) ?? []);
    } finally {
      setLoading(false);
    }
  }, [ipc]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const saveSkillPaths = async () => {
    setSaving(true);
    try {
      await ipc.setSettings({ ...settings, skills: skillPathsDraft } as Record<string, unknown>);
      void refresh();
    } finally {
      setSaving(false);
    }
  };

  const addSkillPath = () => {
    const path = newSkillPath.trim();
    if (!path) return;
    if (!skillPathsDraft.includes(path)) {
      setSkillPathsDraft([...skillPathsDraft, path]);
      setNewSkillPath("");
    }
  };

  const removeSkillPath = (idx: number) => {
    setSkillPathsDraft(skillPathsDraft.filter((_, i) => i !== idx));
  };

  const updateSkillPath = (idx: number, value: string) => {
    setSkillPathsDraft(skillPathsDraft.map((p, i) => (i === idx ? value : p)));
  };

  const createSkill = async () => {
    if (!createName.trim() || !createDescription.trim() || !createContent.trim()) return;
    setActionError(undefined);
    setActionMessage(undefined);
    try {
      const skill = await ipc.createSkill({ name: createName.trim(), description: createDescription.trim(), content: createContent.trim() });
      setCreateName("");
      setCreateDescription("");
      setCreateContent("");
      setActionMessage(`Created and installed ${skill.name}.`);
      await refresh();
      // Set the highlight AFTER the internal refresh so the auto-refresh that
      // repopulates the discovered list doesn't immediately clear it — the
      // badge stays until the user next reloads.
      setLastCreatedSkill(skill.name);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Could not create skill");
    }
  };

  const toggleSkill = async (name: string, enabled: boolean) => {
    const current = settings.disabledSkills ?? [];
    const next = enabled ? current.filter((n) => n !== name) : [...current, name];
    setSettings({ ...settings, disabledSkills: next });
    await ipc.setSettings({ ...settings, disabledSkills: next } as Record<string, unknown>);
  };

  const disabledSkills = settings.disabledSkills ?? [];
  const previewEmpty = !createName.trim() && !createDescription.trim() && !createContent.trim();
  const previewBody = [
    "---",
    `name: ${createName.trim()}`,
    `description: ${createDescription.trim()}`,
    "---",
    "",
    createContent.trim(),
  ].join("\n");

  const installSkill = async () => {
    if (!installPath.trim()) return;
    setActionError(undefined);
    setActionMessage(undefined);
    try {
      const skills = await ipc.installSkill(installPath.trim());
      setInstallPath("");
      setActionMessage(`Installed skill path. ${skills.length} skills are now visible to the daemon.`);
      await refresh();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Could not install skill");
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: tokens.space.lg }}>
      {loading ? (
        <div style={{ display: "flex", justifyContent: "center", padding: tokens.space["3xl"] }}>
          <Spinner size={22} />
        </div>
      ) : (
        <>
          <Card variant="raised" padding="lg" style={{ display: "flex", flexDirection: "column", gap: tokens.space.lg }}>
            {/* Header row: the icon tile is neutral, not accent-washed — green
                is a status signal, and a section icon carries no status. The
                Reload control is vertically centred against the 34px tile so
                the title does not read as pulled off-centre (vision-critic
                D5). */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", minHeight: 34 }}>
              <div style={{ display: "flex", alignItems: "center", gap: tokens.space.md }}>
                <span
                  style={{
                    width: 34,
                    height: 34,
                    flexShrink: 0,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    borderRadius: tokens.radius.md,
                    background: tokens.color.surface2,
                    border: `1px solid ${tokens.color.border}`,
                    color: tokens.color.textMuted,
                  }}
                >
                  <BookIcon size={16} />
                </span>
                <Text variant="label" weight="semibold">
                  Skills
                </Text>
              </div>
              <Button variant="ghost" size="sm" icon={<RefreshIcon size={13} />} onClick={refresh}>
                Reload
              </Button>
            </div>

            <Text variant="body" tone="muted">
              Skill discovery is managed by the daemon. This panel reads the live resource snapshot,
              so the list below is what this session can actually invoke — not a browser-side catalog.
              Skill paths remain configurable here and are applied on the next daemon session.
            </Text>
          </Card>

          <Card variant="raised" padding="lg" style={{ display: "flex", flexDirection: "column", gap: tokens.space.lg }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div style={{ display: "flex", alignItems: "center", gap: tokens.space.md }}>
                <Text variant="label" weight="semibold">Discovered skills</Text>
                <Text variant="micro" tone="dim" mono>{runtime?.skills.length ?? 0}</Text>
              </div>
              {runtime?.skillDiagnostics.length ? <Text variant="micro" tone="warning">{runtime.skillDiagnostics.length} diagnostic{runtime.skillDiagnostics.length === 1 ? "" : "s"}</Text> : null}
            </div>
            {runtime?.skills.length ? (
              <div style={{ display: "flex", flexDirection: "column", gap: tokens.space.sm }}>
                {runtime.skills.map((skill) => {
                  const disabled = disabledSkills.includes(skill.name);
                  const justInstalled = skill.name === lastCreatedSkill;
                  return (
                    <div
                      key={`${skill.name}:${skill.filePath ?? ""}`}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: tokens.space.md,
                        padding: tokens.space.md,
                        borderRadius: tokens.radius.md,
                        background: tokens.color.bgElevated,
                        border: `1px solid ${tokens.color.border}`,
                        opacity: disabled ? 0.5 : 1,
                      }}
                    >
                      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: tokens.space.sm }}>
                          <Text variant="label" mono>{skill.name}</Text>
                          {justInstalled ? <Badge tone="success">Just installed</Badge> : null}
                        </div>
                        <Text variant="micro" tone="muted">{skill.description ?? "No description reported by daemon."}</Text>
                        {skill.filePath ? <Text variant="micro" tone="dim" mono style={{ wordBreak: "break-all" }}>{skill.filePath}{skill.source ? ` · ${skill.source}` : ""}</Text> : null}
                      </div>
                      <label style={{ display: "flex", alignItems: "center", gap: tokens.space.sm, cursor: "pointer" }}>
                        <input
                          type="checkbox"
                          checked={!disabled}
                          onChange={(e) => void toggleSkill(skill.name, e.target.checked)}
                          style={{ width: 16, height: 16, accentColor: tokens.color.accent }}
                        />
                        <Text variant="micro" tone="muted">Enable</Text>
                      </label>
                    </div>
                  );
                })}
              </div>
            ) : (
              <Text variant="body" tone="dim">The live daemon reported no discoverable skills for this session.</Text>
            )}
            {runtime?.skillDiagnostics.map((diagnostic, index) => (
              <Text key={`${diagnostic.type}:${index}`} variant="micro" tone="warning">{diagnostic.type}: {diagnostic.message}{diagnostic.path ? ` · ${diagnostic.path}` : ""}</Text>
            ))}
          </Card>

          <Card variant="raised" padding="lg" style={{ display: "flex", flexDirection: "column", gap: tokens.space.lg }}>
            <div style={{ display: "flex", alignItems: "center", gap: tokens.space.md }}>
              <Text variant="label" weight="semibold">Create or install a skill</Text>
              <Badge tone="info">live daemon</Badge>
            </div>
            <Text variant="body" tone="muted">Create a markdown skill in the project resource path, or add an existing skill directory and reload the real daemon resource loader.</Text>
            {actionError ? <Text variant="micro" tone="danger">{actionError}</Text> : null}
            {actionMessage ? <Text variant="micro" tone="success">{actionMessage}</Text> : null}
            <Input label="New skill name" value={createName} onChange={(e) => setCreateName(e.target.value)} placeholder="release-audit" />
            <Input label="Description" value={createDescription} onChange={(e) => setCreateDescription(e.target.value)} placeholder="Audit a release artifact" />
            <TextArea label="SKILL.md instructions" value={createContent} onChange={(e) => setCreateContent(e.target.value)} placeholder="Explain when and how the agent should use this skill." rows={6} />
            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <Button variant="primary" onClick={() => void createSkill()} disabled={!createName.trim() || !createDescription.trim() || !createContent.trim()}>Create and install</Button>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: tokens.space.sm }}>
              <Text variant="micro" tone="dim" uppercase>Preview</Text>
              {previewEmpty ? (
                <Text variant="body" tone="dim">Start typing to see a preview...</Text>
              ) : (
                <pre
                  style={{
                    margin: 0,
                    padding: tokens.space.md,
                    background: tokens.color.bgElevated,
                    border: `1px solid ${tokens.color.border}`,
                    borderRadius: tokens.radius.md,
                    fontFamily: tokens.font.mono,
                    fontSize: tokens.font.size.xs,
                    color: tokens.color.textMuted,
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word",
                  }}
                >
                  {previewBody}
                </pre>
              )}
            </div>
            <div style={{ borderTop: `1px solid ${tokens.color.line}`, paddingTop: tokens.space.md, display: "flex", gap: tokens.space.sm, alignItems: "flex-end" }}>
              <Input label="Existing skill path" value={installPath} onChange={(e) => setInstallPath(e.target.value)} placeholder="C:\\work\\skills\\my-skill" style={{ flex: 1 }} />
              <Button variant="outline" onClick={() => void installSkill()} disabled={!installPath.trim()}>Install path</Button>
            </div>
          </Card>

          <Card variant="raised" padding="lg" style={{ display: "flex", flexDirection: "column", gap: tokens.space.lg }}>
            <div style={{ display: "flex", alignItems: "center", gap: tokens.space.md }}>
              <span
                style={{
                  width: 34,
                  height: 34,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  borderRadius: tokens.radius.md,
                  background: tokens.color.bgOverlay,
                  border: `1px solid ${tokens.color.border}`,
                  color: tokens.color.textDim,
                }}
              >
                <SparkIcon size={16} />
              </span>
              <Text variant="label" weight="semibold">
                Skill paths
              </Text>
            </div>

            <Text variant="body" tone="muted" style={{ fontSize: tokens.font.size.sm }}>
              Add directories or .md files. Supports glob patterns. Prefix with "!" to exclude,
              "+" to force-include. Changes apply on Save.
            </Text>

            <div style={{ display: "flex", flexDirection: "column", gap: tokens.space.sm }}>
              {skillPathsDraft.length === 0 ? (
                <Text variant="body" tone="dim" style={{ padding: tokens.space.md, background: tokens.color.bgElevated, borderRadius: tokens.radius.md, border: `1px solid ${tokens.color.border}` }}>
                  No skill paths configured. Add paths below and click Save.
                </Text>
              ) : (
                skillPathsDraft.map((p, idx) => (
                  <div key={idx} style={{ display: "flex", gap: tokens.space.sm }}>
                    <Input
                      value={p}
                      onChange={(e) => updateSkillPath(idx, e.target.value)}
                      placeholder="~/.prime/agent/skills/my-skill"
                      style={{ flex: 1 }}
                    />
                    <Button variant="ghost" size="sm" icon={<XIcon size={13} />} onClick={() => removeSkillPath(idx)} />
                  </div>
                ))
              )}

              <div style={{ display: "flex", gap: tokens.space.sm }}>
                <Input
                  value={newSkillPath}
                  onChange={(e) => setNewSkillPath(e.target.value)}
                  placeholder="~/.prime/agent/skills/new-skill"
                  style={{ flex: 1 }}
                />
                <Button variant="primary" size="sm" icon={<CheckIcon size={13} />} onClick={addSkillPath}>
                  Add
                </Button>
              </div>

            </div>

            {/* Reference documentation sits ABOVE the action row so the card
                reads state → controls → reference → commit, and the primary
                action is the last thing in the card — the same rule card 1
                follows with Reload (vision-critic D7: one action was inside its
                card, the other stranded mid-card above the help text).
                Wrapped in a hairline #2a2a2a card outline so the discovery
                locations read as a config block, not a paragraph. */}
            <div
              style={{
                border: `1px solid ${tokens.color.border}`,
                borderRadius: tokens.radius.md,
                background: tokens.color.bgElevated,
                padding: `${tokens.space.md} ${tokens.space.lg}`,
              }}
            >
              <Text variant="micro" tone="dim" mono style={{ letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: tokens.space.sm, display: "block" }}>
                Discovery locations
              </Text>
              <Text variant="micro" tone="dim">
                Precedence: CLI → settings → packages → project → global → built-in
                <br />
                • CLI: <Text mono>{`--skill <path>`}</Text>
                <br />
                • Settings: <Text mono>skills: ["path", "!excluded"]</Text>
                <br />
                • Global: <Text mono>~/.prime/agent/skills/</Text>, <Text mono>~/.agents/skills/</Text>
                <br />
                • Project: <Text mono>.prime/agent/skills/</Text>, <Text mono>.agents/skills/</Text>
                <br />
                • Packages: <Text mono>skills/</Text> in npm/git packages
              </Text>
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: tokens.space.sm, borderTop: `1px solid ${tokens.color.border}`, paddingTop: tokens.space.lg }}>
              <Button variant="ghost" onClick={refresh} disabled={saving}>
                Cancel
              </Button>
              <Button variant="primary" onClick={saveSkillPaths} loading={saving} disabled={saving}>
                Save changes
              </Button>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}