// Sophos — Windows-native port of Prime Intellect's Prime Agent. The command-center app shell: routes between the
// views (Chat / Sessions / Agents / Settings) inside the Shell frame, and
// hosts the global ⌘K command palette + new-session modal. Feature modules
// (P4/P5) mount into these views.
//
// Cross-cutting app state (active view, new-session modal, settings tab,
// Sessions pre-filter/selection) lives in <AppStateProvider> so views consume
// it via useAppState() instead of prop-drilling. Global keyboard shortcuts are
// registered here with useHotkeys(); each view is wrapped in its own
// ErrorBoundary so a crash in one view can't take down the whole app.

import { ErrorBoundary } from "./design";
import { ViewTransition } from "./design";
import type { View } from "./shell/nav";
import { Shell } from "./shell/Shell";
import { ChatView } from "./features/chat/ChatView";
import { AgentsView } from "./views/AgentsView";
import { SessionsView } from "./features/sessions/SessionsView";
import { SettingsView } from "./features/settings/SettingsView";
import { InboxView } from "./features/inbox/InboxView";
import { CommandPalette } from "./features/commands/CommandPalette";
import { NewSessionModal } from "./features/sessions/NewSessionModal";
import { UnreadProvider } from "./ipc/unread";
import { ProfileProvider } from "./features/profiles/profiles";
import { TrajectoryProvider } from "./features/trajectory/trajectory";
import { TrajectoryPanel } from "./features/trajectory/TrajectoryPanel";
import { CodeRunProvider } from "./features/code/useCodeRuns";
import { CodePanel } from "./features/code/CodePanel";
import { StudioPanel } from "./features/studio/StudioPanel";
import { AppStateProvider, useAppState } from "./state/AppState";
import { useHotkeys } from "./hooks/useHotkeys";
import { useTheme } from "./hooks/useTheme";

const VIEWS: Record<Exclude<View, "settings">, React.ComponentType> = {
  chat: ChatView,
  sessions: SessionsView,
  agents: AgentsView,
  inbox: InboxView,
};

function AppShell() {
  const {
    view,
    setView,
    newSessionOpen,
    setNewSessionOpen,
    setSettingsTab,
    setSessionsFilter,
    setSessionsSelectedId,
  } = useAppState();
  const ActiveView = VIEWS[view as Exclude<View, "settings">];

  const handleNavigate = (v: View) => {
    if (v === "settings") setSettingsTab("general");
    setView(v);
  };
  const handleFindSession = (filter: string, sessionId: string) => {
    setSessionsFilter(filter);
    setSessionsSelectedId(sessionId);
    setView("sessions");
  };

  // Global keyboard shortcuts (cross-platform: Cmd or Ctrl).
  useHotkeys([
    { key: "1", modifiers: ["cmd"], description: "Switch to Chat", handler: () => setView("chat") },
    { key: "2", modifiers: ["cmd"], description: "Switch to Sessions", handler: () => setView("sessions") },
    { key: "3", modifiers: ["cmd"], description: "Switch to Agents", handler: () => setView("agents") },
    { key: "4", modifiers: ["cmd"], description: "Switch to Inbox", handler: () => setView("inbox") },
    { key: "n", modifiers: ["cmd"], description: "Open new session", handler: () => setNewSessionOpen(true) },
    { key: ",", modifiers: ["cmd"], description: "Open Settings", handler: () => { setSettingsTab("general"); setView("settings"); } },
  ]);

  return (
    <>
      <Shell active={view} onNavigate={handleNavigate}>
        <ViewTransition transitionKey={view}>
          {view === "settings" ? (
            <ErrorBoundary label="Settings">
              <SettingsView />
            </ErrorBoundary>
          ) : view === "sessions" ? (
            <ErrorBoundary label="Sessions">
              <SessionsView />
            </ErrorBoundary>
          ) : (
            <ErrorBoundary label={view}>
              <ActiveView />
            </ErrorBoundary>
          )}
        </ViewTransition>
      </Shell>
      <CommandPalette
        onNavigate={setView}
        onNewSession={() => setNewSessionOpen(true)}
        onFindSession={handleFindSession}
      />
      <NewSessionModal
        open={newSessionOpen}
        onClose={() => setNewSessionOpen(false)}
        onCreated={() => {
          setNewSessionOpen(false);
          setView("sessions");
        }}
      />
      <TrajectoryPanel />
      <CodePanel />
      <StudioPanel />
    </>
  );
}

export default function App() {
  useTheme();
  return (
    <UnreadProvider>
      <AppStateProvider>
        <ProfileProvider>
          <TrajectoryProvider>
            <CodeRunProvider>
              <AppShell />
            </CodeRunProvider>
          </TrajectoryProvider>
        </ProfileProvider>
      </AppStateProvider>
    </UnreadProvider>
  );
}
