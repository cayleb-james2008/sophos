// Shell — the Sophos app frame: a translucent Monitor bar, quiet navigation,
// routed content, and an on-demand engine terminal. Hosts the global
// keyboard-shortcuts overlay so the `?` and `Cmd/Ctrl+/` shortcuts stay
// discoverable everywhere in the app.

import React, { useMemo, useState } from "react";
import { SystemBar } from "./SystemBar";
import { Sidebar } from "./Sidebar";
import { DaemonStatusBanner } from "../features/settings/DaemonStatusBanner";
import { EnginePanel } from "../features/engine/EnginePanel";
import { RefinementGateProvider } from "../features/longrunning/useRefinementGate";
import { RefinementGateBanner } from "../features/longrunning/RefinementGateBanner";
import { RunGuardBanner } from "../features/longrunning/RunGuardBanner";
import { ShortcutsOverlay, type ShortcutsGroup } from "../design";
import { useHotkeys, type Hotkey } from "../hooks/useHotkeys";
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
  const [shortcutsOpen, setShortcutsOpen] = useState(false);

  // Toggle handler shared between the `?` and `Cmd/Ctrl+/` key bindings. Both
  // bindings flip the same overlay state — a discoverable shortcut should work
  // from any layout.
  const toggleShortcuts = () => setShortcutsOpen((s) => !s);

  // Register the overlay's key bindings here so the wiring stays co-located
  // with the overlay's owner (Shell). useHotkeys ignores keypresses inside
  // text fields, so typing `?` in a chat input is safe.
  const shortcutHotkeys: Hotkey[] = useMemo(
    () => [
      { key: "?", description: "Show keyboard shortcuts", handler: toggleShortcuts },
      { key: "/", modifiers: ["cmd"], description: "Show keyboard shortcuts", handler: toggleShortcuts },
    ],
    [],
  );
  useHotkeys(shortcutHotkeys);

  const groups: ShortcutsGroup[] = useMemo(
    () => [
      {
        title: "App",
        shortcuts: shortcutHotkeys,
      },
    ],
    [shortcutHotkeys],
  );

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
      <ShortcutsOverlay open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} groups={groups} />
    </div>
  );
}
