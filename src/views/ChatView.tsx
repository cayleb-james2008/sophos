// Chat view — placeholder. The chat feature module (P4) builds against the
// design system + IPC client; this scaffold shows the shell's empty state.

import { ViewScaffold } from "./ViewScaffold";
import { EmptyState } from "./EmptyState";
import { ChatIcon } from "../shell/icons";

export function ChatView() {
  return (
    <ViewScaffold
      index="Chat"
      title="Conversation"
      description="Talk to the agent. The chat module lands here, wired to the IPC client."
    >
      <EmptyState
        icon={<ChatIcon size={28} />}
        badge="Module pending"
        title="No active conversation"
        description="Start a session to begin talking with the agent. Messages, streaming, and tool calls will render here."
        actionLabel="New session"
        meta="prompt · steer · abort"
      />
    </ViewScaffold>
  );
}
