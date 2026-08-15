// SettingsView — the settings command center. Fleet telemetry strip up top,
// then tabbed panels: General (preferences), Providers (catalog + auth),
// Skills (discovery + management), and Advanced (context + RLM children +
// agents + daemon diagnostics + MCP + extensions). Wired to the IPC client.

import { Tabs } from "../../design";
import { useAppState } from "../../state/AppState";
import { GeneralPanel } from "./GeneralPanel";
import { ProvidersPanel } from "./ProvidersPanel";
import { SkillsPanel } from "./SkillsPanel";
import { ExtensionsPanel } from "./ExtensionsPanel";
import { AdvancedPanel } from "./AdvancedPanel";
import { LongRunningPanel } from "./LongRunningPanel";
import { AboutPanel } from "./AboutPanel";
import { FleetStrip } from "./FleetStrip";
import "./settings.css";

export function SettingsView() {
  const { settingsTab: tab, setSettingsTab: setTab } = useAppState();

  return (
    <main className="settings">
      <header className="settings__header">
        <div className="settings__eyebrow">CONTROL ROOM</div>
        <h1>Settings</h1>
        <p>Providers, models, preferences, skills, extensions, and runtime telemetry.</p>
      </header>

      <FleetStrip />

      <Tabs
        variant="pill"
        items={[
          { id: "general", label: "General" },
          { id: "providers", label: "Providers" },
          { id: "skills", label: "Skills" },
          { id: "extensions", label: "Extensions" },
          { id: "advanced", label: "Advanced" },
          { id: "longrunning", label: "Long-running" },
          { id: "about", label: "About" },
        ]}
        activeId={tab}
        onChange={setTab}
      />

      <div className="settings__body">
        {tab === "general" ? <GeneralPanel /> : null}
        {tab === "providers" ? <ProvidersPanel /> : null}
        {tab === "skills" ? <SkillsPanel /> : null}
        {tab === "extensions" ? <ExtensionsPanel /> : null}
        {tab === "advanced" ? <AdvancedPanel /> : null}
        {tab === "longrunning" ? <LongRunningPanel /> : null}
        {tab === "about" ? <AboutPanel /> : null}
      </div>
    </main>
  );
}