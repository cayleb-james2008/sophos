// AppState — app-level view/session/modal state as a single React context.
//
// Replaces the local `useState` + prop-drilling in App.tsx: the active view,
// new-session modal, settings tab, and the Sessions view's pre-filter/selection
// are all held here so views can read and mutate shared state directly instead
// of receiving callbacks through props. Keep this surface small and stable —
// it is the cross-cutting state the whole command center reads.

import React, { createContext, useContext, useMemo, useState } from "react";
import type { View } from "../shell/nav";

export interface AppStateValue {
  view: View;
  setView: (view: View) => void;
  newSessionOpen: boolean;
  setNewSessionOpen: (open: boolean) => void;
  settingsTab: string;
  setSettingsTab: (tab: string) => void;
  sessionsFilter: string | undefined;
  setSessionsFilter: (filter: string | undefined) => void;
  sessionsSelectedId: string | undefined;
  setSessionsSelectedId: (id: string | undefined) => void;
  /** Trajectory panel (right drawer) open state — v0.7 conversation-first chrome. */
  trajectoryOpen: boolean;
  setTrajectoryOpen: (open: boolean) => void;
  /** Code Mode panel (right drawer) open state — v0.7.1 run_code program view. */
  codeOpen: boolean;
  setCodeOpen: (open: boolean) => void;
}

const AppStateContext = createContext<AppStateValue | undefined>(undefined);

export function AppStateProvider({ children }: { children: React.ReactNode }) {
  const [view, setView] = useState<View>("chat");
  const [newSessionOpen, setNewSessionOpen] = useState(false);
  // Which Settings tab to open when the Settings view mounts. The first-run
  // onboarding (U1) deep-links straight to Providers; sidebar navigation
  // resets to General.
  const [settingsTab, setSettingsTab] = useState("general");
  // P4: pre-filter + selection for the Sessions view, set by the ⌘K
  // "Find session…" command so it can land filtered.
  const [sessionsFilter, setSessionsFilter] = useState<string | undefined>();
  const [sessionsSelectedId, setSessionsSelectedId] = useState<string | undefined>();
  const [trajectoryOpen, setTrajectoryOpen] = useState(false);
  const [codeOpen, setCodeOpen] = useState(false);

  const value = useMemo<AppStateValue>(
    () => ({
      view,
      setView,
      newSessionOpen,
      setNewSessionOpen,
      settingsTab,
      setSettingsTab,
      sessionsFilter,
      setSessionsFilter,
      sessionsSelectedId,
      setSessionsSelectedId,
      trajectoryOpen,
      setTrajectoryOpen,
      codeOpen,
      setCodeOpen,
    }),
    [view, newSessionOpen, settingsTab, sessionsFilter, sessionsSelectedId, trajectoryOpen, codeOpen],
  );

  return <AppStateContext.Provider value={value}>{children}</AppStateContext.Provider>;
}

/** Access the app-level state context. Throws when used outside the provider. */
export function useAppState(): AppStateValue {
  const ctx = useContext(AppStateContext);
  if (!ctx) {
    throw new Error("useAppState must be used within an <AppStateProvider>");
  }
  return ctx;
}
