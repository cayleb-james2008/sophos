// LongRunningPanel — the Long-running settings section.
//
// B1 (vision critic D12): the long-running surface used to sit three tiers deep
// (Settings sidebar → "Advanced" → inner pill "Runtime telemetry | Long-running"
// → underline "Goals | Autonomous | Heartbeats | Schedules | Refinement"). This
// panel is Long-running's own top-level Settings entry, so the surface is now
// exactly two tiers deep: Settings sidebar → these five section tabs. "Advanced"
// is left purely to runtime telemetry. The redundant "Long-running & background
// agents" label is dropped — the tab already says it.

import { useState } from "react";
import { tokens } from "../../design/tokens";
import { Tabs } from "../../design";
import { AutonomousPanel } from "../longrunning/AutonomousPanel";
import { HeartbeatsPanel } from "../longrunning/HeartbeatsPanel";
import { SchedulesPanel } from "../longrunning/SchedulesPanel";
import { RefinementHistory } from "../longrunning/RefinementHistory";
import { GoalsPanel } from "../goals/GoalsPanel";

export function LongRunningPanel() {
  const [tab, setTab] = useState("autonomous");
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: tokens.space.lg }}>
      <Tabs
        variant="underline"
        items={[
          { id: "goals", label: "Goals" },
          { id: "autonomous", label: "Autonomous" },
          { id: "heartbeats", label: "Heartbeats" },
          { id: "schedules", label: "Schedules" },
          { id: "refinement", label: "Refinement" },
        ]}
        activeId={tab}
        onChange={setTab}
      />
      {tab === "goals" ? <GoalsPanel /> : null}
      {tab === "autonomous" ? <AutonomousPanel /> : null}
      {tab === "heartbeats" ? <HeartbeatsPanel /> : null}
      {tab === "schedules" ? <SchedulesPanel /> : null}
      {tab === "refinement" ? <RefinementHistory /> : null}
    </div>
  );
}

export default LongRunningPanel;
