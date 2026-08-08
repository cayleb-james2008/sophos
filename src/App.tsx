// Prime Agent — Windows. The command-center app shell: routes between the
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

type ViewProps = { onNewSession?: () => void };

const VIEWS: Record<View, React.ComponentType<ViewProps>> = {
  chat: ChatView,
  sessions: SessionsView,
  agents: AgentsView,
  inbox: InboxView,
  settings: SettingsView,
};

export default function App() {
  const [view, setView] = useState<View>("chat");
  const [newOpen, setNewOpen] = useState(false);
  const ActiveView = VIEWS[view];

  return (
    <UnreadProvider>
      <Shell active={view} onNavigate={setView}>
        <ViewTransition transitionKey={view}>
          <ActiveView onNewSession={() => setNewOpen(true)} />
        </ViewTransition>
      </Shell>
      <CommandPalette onNavigate={setView} onNewSession={() => setNewOpen(true)} />
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
