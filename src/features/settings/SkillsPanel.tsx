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
import { Text, Card, Button, Input, Spinner } from "../../design";
import { useIpc } from "../../ipc/client";
import type { Settings } from "../../ipc/contract";
import { RefreshIcon, BookIcon, CheckIcon, XIcon, SparkIcon } from "../sessions/icons";

interface ExtendedSettings extends Settings {
  enableBuiltinSkills?: boolean;
  enableSkillCommands?: boolean;
  bundledSkills?: { websearch?: boolean };
  skills?: string[];
  packages?: Array<string | { source: string }>;
}

export function SkillsPanel() {
  const ipc = useIpc();
  const [loading, setLoading] = useState(true);
  const [settings, setSettings] = useState<ExtendedSettings>({});
  const [skillPathsDraft, setSkillPathsDraft] = useState<string[]>([]);
  const [newSkillPath, setNewSkillPath] = useState("");
  const [saving, setSaving] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const s = await ipc.getSettings();
      const ext = s as ExtendedSettings;
      setSettings(ext);
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
              Skill discovery is managed by the daemon. This panel shows the skill paths configured
              in settings.json. Built-in skills (prime-intellect, skill-creator, websearch) are
              enabled via the daemon's settings — use <Text mono>/settings</Text> in the CLI or
              edit <Text mono>~/.prime/agent/settings.json</Text> directly to toggle them.
            </Text>
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
                card, the other stranded mid-card above the help text). */}
            <Text variant="micro" tone="dim">
              Discovery locations (precedence: CLI → settings → packages → project → global → built-in):
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