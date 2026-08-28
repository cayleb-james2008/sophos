// SettingsView — the settings command center. Fleet telemetry strip up top,
// then tabbed panels: General (preferences), Providers (catalog + auth),
// Skills (discovery + management), and Advanced (context + RLM children +
// agents + daemon diagnostics + MCP + extensions). Wired to the IPC client.

import { Tabs } from "../../design";
import { useAppState } from "../../state/AppState";
import { GeneralPanel } from "./GeneralPanel";
import { ProvidersPanel } from "./ProvidersPanel";
import { SkillsPanel } from "./SkillsPanel";
import { SubagentPolicyPanel } from "./SubagentPolicyPanel";
import { ExtensionsPanel } from "./ExtensionsPanel";
import { AdvancedPanel } from "./AdvancedPanel";
import { LongRunningPanel } from "./LongRunningPanel";
import { AboutPanel } from "./AboutPanel";
import { FleetStrip } from "./FleetStrip";
import { MigrationWizard } from "../migration";
import { McpExplorer } from "../mcp";
import { SecuritySandboxPanel } from "../security";
import { CuaControlPanel } from "../cua";
import { SkillDistillationPanel } from "../skills";
import { ThoughtTreePanel } from "../tree";
import "./settings.css";

export function SettingsView() {
  const { settingsTab: tab, setSettingsTab: setTab } = useAppState();

  return (
    <main className="settings">
      <header className="settings__header">
        <div className="settings__eyebrow">CONTROL ROOM</div>
        <h1>Settings</h1>
        <p>
          Providers, models, preferences, skills, skill distillation, tree of thoughts, extensions, MCP,
          security sandbox, desktop CUA, migration, and runtime telemetry.
        </p>
      </header>

      <FleetStrip />

      <Tabs
        variant="pill"
        items={[
          { id: "general", label: "General" },
          { id: "providers", label: "Providers" },
          { id: "mcp", label: "MCP Explorer" },
          { id: "security", label: "Security & Sandbox" },
          { id: "cua", label: "Desktop CUA" },
          { id: "distill", label: "Skill Distillation" },
          { id: "tree", label: "Tree of Thoughts" },
          { id: "subagents", label: "Subagents" },
          { id: "skills", label: "Skills" },
          { id: "extensions", label: "Extensions" },
          { id: "advanced", label: "Advanced" },
          { id: "longrunning", label: "Long-running" },
          { id: "migration", label: "Import" },
          { id: "about", label: "About" },
        ]}
        activeId={tab}
        onChange={setTab}
      />

      <div className="settings__body">
        {tab === "general" ? <GeneralPanel /> : null}
        {tab === "providers" ? <ProvidersPanel /> : null}
        {tab === "mcp" ? <McpExplorer /> : null}
        {tab === "security" ? <SecuritySandboxPanel /> : null}
        {tab === "cua" ? <CuaControlPanel /> : null}
        {tab === "distill" ? <SkillDistillationPanel /> : null}
        {tab === "tree" ? <ThoughtTreePanel /> : null}
        {tab === "subagents" ? <SubagentPolicyPanel /> : null}
        {tab === "skills" ? <SkillsPanel /> : null}
        {tab === "extensions" ? <ExtensionsPanel /> : null}
        {tab === "advanced" ? <AdvancedPanel /> : null}
        {tab === "longrunning" ? <LongRunningPanel /> : null}
        {tab === "migration" ? <MigrationWizard /> : null}
        {tab === "about" ? <AboutPanel /> : null}
      </div>
    </main>
  );
}
