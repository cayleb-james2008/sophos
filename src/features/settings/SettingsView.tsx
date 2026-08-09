// SettingsView — the settings command center. Fleet telemetry strip up top,
// then tabbed panels: General (preferences), Providers (catalog + auth),
// Skills (discovery + management), and Advanced (context + RLM children +
// agents + daemon diagnostics + MCP + extensions). Wired to the IPC client.

import { useState } from "react";
import { Tabs } from "../../design";
import { GeneralPanel } from "./GeneralPanel";
import { ProvidersPanel } from "./ProvidersPanel";
import { SkillsPanel } from "./SkillsPanel";
import { AdvancedPanel } from "./AdvancedPanel";
import { FleetStrip } from "./FleetStrip";
import "./settings.css";

export function SettingsView({ initialTab = "general" }: { initialTab?: string }) {
  const [tab, setTab] = useState(initialTab);

  return (
    <main className="settings">
      <header className="settings__header">
        <div className="settings__eyebrow">CONTROL ROOM</div>
        <h1>Settings</h1>
        <p>Providers, models, preferences, skills, and runtime telemetry.</p>
      </header>

      <FleetStrip />

      <Tabs
        variant="pill"
        items={[
          { id: "general", label: "General" },
          { id: "providers", label: "Providers" },
          { id: "skills", label: "Skills" },
          { id: "advanced", label: "Advanced" },
        ]}
        activeId={tab}
        onChange={setTab}
      />

      <div className="settings__body">
        {tab === "general" ? <GeneralPanel /> : null}
        {tab === "providers" ? <ProvidersPanel /> : null}
        {tab === "skills" ? <SkillsPanel /> : null}
        {tab === "advanced" ? <AdvancedPanel /> : null}
      </div>
    </main>
  );
}