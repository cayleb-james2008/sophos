// Shell — the Sophos app frame: SystemBar (live telemetry strip) on top,
// a nav rail on the left, a routed main content area over a stark near-black
// surface, and a collapsible Engine terminal panel at the bottom.

import React, { useState } from "react";
import { tokens } from "../design/tokens";
import { SystemBar } from "./SystemBar";
import { Sidebar } from "./Sidebar";
import { DaemonStatusBanner } from "../features/settings/DaemonStatusBanner";
import { EnginePanel } from "../features/engine/EnginePanel";
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
          <div style={{ flex: 1, position: "relative", overflow: "hidden", display: "flex", flexDirection: "column" }}>
            {/* Stark near-black surface — no grid, no wash */}

            {/* Scrollable content: daemon banner + routed view */}
            <div style={{ position: "relative", height: "100%", overflowY: "auto", display: "flex", flexDirection: "column" }}>
              <DaemonStatusBanner />
              <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>{children}</div>
            </div>
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
