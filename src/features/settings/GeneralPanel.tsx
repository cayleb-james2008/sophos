// GeneralPanel — the settings form: shell path, session dir, default
// provider/model, theme, and daemon CLI path. Loads via getSettings() and
// persists via setSettings().

import { useEffect, useState } from "react";
import { Text, Card, Input, Select, Button, Badge } from "../../design";
import { useIpc } from "../../ipc/client";
import { useAppState } from "../../state/AppState";
import { clearOnboardingDismissed } from "./FirstRunBanner";
import type { Settings } from "../../ipc/contract";

const THEME_OPTIONS = [
  { value: "dark", label: "Dark (command center)" },
  { value: "light", label: "Light" },
  { value: "system", label: "System" },
];

export function GeneralPanel() {
  const ipc = useIpc();
  const { setView } = useAppState();
  const [draft, setDraft] = useState<Settings>({});
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let mounted = true;
    ipc
      .getSettings()
      .then((s) => {
        if (mounted) {
          setDraft(s);
          setLoaded(true);
        }
      })
      .catch(() => {
        if (mounted) setLoaded(true);
      });
    return () => {
      mounted = false;
    };
  }, [ipc]);

  const set = (patch: Partial<Settings>) => setDraft((d) => ({ ...d, ...patch }));

  const save = async () => {
    setSaving(true);
    try {
      await ipc.setSettings(draft);
      setSaved(true);
      window.setTimeout(() => setSaved(false), 1800);
    } finally {
      setSaving(false);
    }
  };

  const runOnboardingAgain = () => {
    clearOnboardingDismissed();
    setView("chat");
  };

  return (
    <Card variant="raised" padding="lg">
      <div className="gp-form">
        <div className="gp-head">
          <Text variant="label" weight="semibold">
            General preferences
          </Text>
          {saved ? <Badge tone="success" dot>Saved</Badge> : <Badge tone="neutral">Local</Badge>}
        </div>

        <div className="gp-grid">
          <Select
            label="Theme"
            options={THEME_OPTIONS}
            value={draft.theme ?? "dark"}
            onChange={(e) => set({ theme: e.target.value as Settings["theme"] })}
          />
          <Input
            label="Default provider"
            value={draft.defaultProvider ?? ""}
            onChange={(e) => set({ defaultProvider: e.target.value })}
            placeholder="ollama-cloud"
            hint="Provider used for new sessions"
          />
        </div>

        <Input
          label="Default model"
          value={draft.defaultModel ?? ""}
          onChange={(e) => set({ defaultModel: e.target.value })}
          placeholder="deepseek-v4-flash:0731-cloud"
          hint="Model used for new sessions"
        />

        <div className="gp-grid">
          <Input
            label="Shell path"
            value={draft.shellPath ?? ""}
            onChange={(e) => set({ shellPath: e.target.value })}
            placeholder="C:\Windows\System32\cmd.exe"
            hint="Optional — overrides the default shell"
          />
          <Input
            label="Session directory"
            value={draft.sessionDir ?? ""}
            onChange={(e) => set({ sessionDir: e.target.value })}
            placeholder="C:\Users\you\.prime\sessions"
            hint="Where sessions are stored"
          />
        </div>

        <Input
          label="Daemon CLI path"
          value={draft.daemonCliPath ?? ""}
          onChange={(e) => set({ daemonCliPath: e.target.value })}
          placeholder="C:\path\to\daemon-cli.exe"
          hint="Optional — path to the daemon CLI binary"
        />

        <div className="gp-foot">
          <Button variant="ghost" onClick={() => setDraft({})} disabled={!loaded}>
            Reset
          </Button>
          <Button variant="ghost" onClick={runOnboardingAgain} title="Clear the first-run dismiss flag and relaunch the onboarding wizard">
            Run onboarding again
          </Button>
          <Button variant="primary" onClick={save} loading={saving} disabled={!loaded}>
            Save changes
          </Button>
        </div>
      </div>
    </Card>
  );
}
