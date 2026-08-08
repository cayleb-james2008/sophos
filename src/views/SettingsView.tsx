// Settings view — the real settings feature module (P4).
// Providers, models, preferences, skills, and runtime telemetry.

import { ViewScaffold } from "./ViewScaffold";
import { SettingsView as SettingsFeature } from "../features/settings/SettingsView";

export function SettingsView() {
  return (
    <ViewScaffold
      index="Settings"
      title="Settings"
      description="Providers, models, preferences, skills, and runtime telemetry."
    >
      <SettingsFeature />
    </ViewScaffold>
  );
}