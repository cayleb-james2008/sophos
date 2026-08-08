// AgentComposer — the send-to-agent relay at the foot of the detail pane.
// Mirrors the InboxView composer: textarea, Cmd/Ctrl+Enter to send, length
// counter, loading state, and a clear-plain-English send error path.

import { Button, Text } from "../../design";
import type { AgentRow } from "./useAgents";

interface AgentComposerProps {
  agent: AgentRow | null;
  draft: string;
  setDraft: (v: string) => void;
  sending: boolean;
  onSend: () => void;
}

export function AgentComposer({ agent, draft, setDraft, sending, onSend }: AgentComposerProps) {
  const target = agent?.name ?? "AGENT";
  const remaining = Math.max(0, 2000 - draft.length);
  const canSend = draft.trim().length > 0 && !sending;

  return (
    <div className="ag-composer">
      <div className="ag-composer__label">
        <span>
          MESSAGE TO <b>{target}</b>
        </span>
        <span>⌘ ↵ TO SEND</span>
      </div>

      <textarea
        aria-label={`Message to ${target}`}
        className="ag-composer__area"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
            e.preventDefault();
            if (canSend) onSend();
          }
        }}
        placeholder="Transmit a clear, bounded instruction…"
        maxLength={2000}
      />

      <div className="ag-composer__foot">
        <Text variant="micro" tone="dim" mono>
          {draft.length} / 2000 · encrypted agent channel · {remaining} remaining
        </Text>
        <Button size="sm" loading={sending} disabled={!canSend} onClick={onSend}>
          Send message ↗
        </Button>
      </div>
    </div>
  );
}
