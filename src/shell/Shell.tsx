// Shell — the Sophos app frame: a translucent Monitor bar, quiet navigation,
// routed content, and an on-demand engine terminal.

import React, { useState } from "react";
import { SystemBar } from "./SystemBar";
import { Sidebar } from "./Sidebar";
import { DaemonStatusBanner } from "../features/settings/DaemonStatusBanner";
import { EnginePanel } from "../features/engine/EnginePanel";
import { RefinementGateProvider } from "../features/longrunning/useRefinementGate";
import { RefinementGateBanner } from "../features/longrunning/RefinementGateBanner";
import { RunGuardBanner } from "../features/longrunning/RunGuardBanner";
import type { View } from "./nav";
import "./shell.css";

export function Shell({
  active,
  onNavigate,
  children,
}: {
  active: View;
  onNavigate: (view: View) => void;
  children: React.ReactNode;
}) {
  const [engineOpen, setEngineOpen] = useState(false);

  return (
    <div className="sophos-shell">
      <SystemBar engineOpen={engineOpen} onToggleEngine={() => setEngineOpen((open) => !open)} />
      <RefinementGateProvider />
      <RefinementGateBanner />
      <RunGuardBanner />
      <div className="shell__body">
        <Sidebar active={active} onNavigate={onNavigate} />
        <main className="shell__main">
          <div className="shell__view-wrap">
            <DaemonStatusBanner />
            {children}
          </div>
          <div className={`shell__engine${engineOpen ? " shell__engine--open" : ""}`}>
            <EnginePanel open={engineOpen} />
          </div>
        </main>
      </div>
    </div>
  );
}
