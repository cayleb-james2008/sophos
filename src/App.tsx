// Sophos — Windows-native port of Prime Intellect's Prime Agent. The command-center app shell: routes between the
// views (Chat / Sessions / Agents / Settings) inside the Shell frame, and
// hosts the global ⌘K command palette + new-session modal. Feature modules
// (P4/P5) mount into these views.

import React, { useState } from "react";
import { Shell } from "./shell/Shell";
import { ViewTransition } from "./design";
import type { View } from "./shell/nav";
import { ChatView } from "./features/chat/ChatView";
import { AgentsView } from "./views/AgentsView";
import { SessionsView } from "./features/sessions/SessionsView";
import { SettingsView } from "./features/settings/SettingsView";
import { InboxView } from "./features/inbox/InboxView";
import { CommandPalette } from "./features/commands/CommandPalette";
import { NewSessionModal } from "./features/sessions/NewSessionModal";
import { UnreadProvider } from "./ipc/unread";

type ViewProps = {
  onNewSession?: () => void;
  onSetupProviders?: () => void;
};

const VIEWS: Record<Exclude<View, "settings">, React.ComponentType<ViewProps>> = {
  chat: ChatView,
  sessions: SessionsView,
  agents: AgentsView,
  inbox: InboxView,
};

export default function App() {
  const [view, setView] = useState<View>("chat");
  const [newOpen, setNewOpen] = useState(false);
  // Which Settings tab to open when the Settings view mounts. The first-run
  // onboarding (U1) deep-links straight to Providers; sidebar navigation
  // resets to General.
  const [settingsTab, setSettingsTab] = useState("general");
  // P4: pre-filter + selection for the Sessions view, set by the ⌘K
  // "Find session…" command so it can land filtered.
  const [sessionsFilter, setSessionsFilter] = useState<string | undefined>();
  const [sessionsSelectedId, setSessionsSelectedId] = useState<string | undefined>();
  const ActiveView = VIEWS[view as Exclude<View, "settings">];

  const handleNavigate = (v: View) => {
    if (v === "settings") setSettingsTab("general");
    setView(v);
  };
  const handleSetupProviders = () => {
    setSettingsTab("providers");
    setView("settings");
  };
  const handleFindSession = (filter: string, sessionId: string) => {
    setSessionsFilter(filter);
    setSessionsSelectedId(sessionId);
    setView("sessions");
  };
  return (
    <UnreadProvider>
      <Shell active={view} onNavigate={handleNavigate}>
        <ViewTransition transitionKey={view}>
          {view === "settings" ? (
            <SettingsView initialTab={settingsTab} />
          ) : view === "sessions" ? (
            <SessionsView
              onNewSession={() => setNewOpen(true)}
              initialFilter={sessionsFilter}
              initialSelectedId={sessionsSelectedId}
            />
          ) : (
            <ActiveView
              onNewSession={() => setNewOpen(true)}
              onSetupProviders={handleSetupProviders}
            />
          )}
        </ViewTransition>
      </Shell>
      <CommandPalette
        onNavigate={setView}
        onNewSession={() => setNewOpen(true)}
        onFindSession={handleFindSession}
      />
      <NewSessionModal
        open={newOpen}
        onClose={() => setNewOpen(false)}
        onCreated={() => {
          setNewOpen(false);
          setView("sessions");
        }}
      />
    </UnreadProvider>
  );
}
