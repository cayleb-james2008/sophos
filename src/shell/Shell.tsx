// Shell — the Sophos app frame: SystemBar (live telemetry strip) on top,
// a nav rail on the left, a routed main content area over a stark near-black
// surface, and a collapsible Engine terminal panel at the bottom.

import React, { useState } from "react";
import { tokens } from "../design/tokens";
import { SystemBar } from "./SystemBar";
import { Sidebar } from "./Sidebar";
import { DaemonStatusBanner } from "../features/settings/DaemonStatusBanner";
import { EnginePanel } from "../features/engine/EnginePanel";
import { RefinementGateProvider } from "../features/longrunning/useRefinementGate";
import { RefinementGateBanner } from "../features/longrunning/RefinementGateBanner";
import type { View } from "./nav";

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
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100vh",
        background: tokens.color.bg,
        color: tokens.color.text,
        fontFamily: tokens.font.sans,
      }}
    >
      <SystemBar engineOpen={engineOpen} onToggleEngine={() => setEngineOpen(!engineOpen)} />
      <RefinementGateProvider />
      <RefinementGateBanner />
      <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
        <Sidebar active={active} onNavigate={onNavigate} />
        <main
          style={{
            flex: 1,
            minWidth: 0,
            position: "relative",
            overflow: "hidden",
            background: tokens.color.bg,
            display: "flex",
            flexDirection: "column",
          }}
        >
          <div style={{ flex: 1, minHeight: 0, position: "relative", overflow: "hidden", display: "flex", flexDirection: "column" }}>
            {/* Stark near-black surface — no grid, no wash */}

            {/* View area: fixed-height flex column. Each routed view owns its own
                scroll (the Chat view's MessageList scrolls; ViewScaffold views
                scroll via overflowY:auto). This lets the view area shrink cleanly
                when the Engine terminal opens below — no overlap. */}
            <DaemonStatusBanner />
            <div style={{ flex: 1, minHeight: 0, overflow: "hidden", display: "flex", flexDirection: "column" }}>{children}</div>
          </div>

          {/* Engine terminal panel — bottom collapsible */}
          <div
            style={{
              flexShrink: 0,
              height: engineOpen ? "320px" : 0,
              overflow: "hidden",
              transition: `height ${tokens.motion.base} ${tokens.motion.easeOut}`,
            }}
          >
            <EnginePanel open={engineOpen} />
          </div>
        </main>
      </div>
    </div>
  );
}
