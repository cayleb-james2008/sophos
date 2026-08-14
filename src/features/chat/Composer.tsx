// Composer — the prompt input. Thin orchestrator composing the input box, the
// pending follow-up queue, inline side-question panels, and the transient
// steer/shell indicators. Interaction handling lives in ComposerInput.

import { Text, Kbd } from "../../design";
import type { FollowUp, SideQuestion } from "./useChat";
import { ComposerInput } from "./ComposerInput";
import { FollowUpQueue } from "./FollowUpQueue";
import { SideQuestionPanel } from "./SideQuestionPanel";
import { ShellNoticeBar } from "./ShellNoticeBar";

export function Composer({
  busy,
  setupReady = true,
  editDraft,
  starterDraft,
  onSend,
  onAbort,
  onSteer,
  onQueueFollowUp,
  onClearFollowUps,
  onPopFollowUp,
  followUps,
  steered,
  shellNotice,
  onSideQuestion,
  sideQuestions,
  onDismissSideQuestion,
  onShell,
  onSetName,
}: {
  busy: boolean;
  /** Real Tauri onboarding health gate; browser preview remains usable. */
  setupReady?: boolean;
  editDraft: { index: number; text: string } | null;
  /** A starter prompt picked from the empty state — fills the editor (no auto-send). */
  starterDraft: { seq: number; text: string } | null;
  onSend: (text: string) => void;
  onAbort: () => void;
  onSteer: (text: string) => void;
  onQueueFollowUp: (text: string) => void;
  onClearFollowUps: () => void;
  onPopFollowUp: () => string | undefined;
  followUps: FollowUp[];
  steered: { text: string; at: number } | null;
  shellNotice: { command: string; hidden: boolean } | null;
  onSideQuestion: (kind: "btw" | "side", question: string) => void;
  sideQuestions: SideQuestion[];
  onDismissSideQuestion: (id: string) => void;
  onShell: (command: string, hidden: boolean) => void;
  onSetName: (name: string) => void;
}) {
  return (
    <div className="composer">
      <div className="composer-inner">
        {/* Inline side questions */}
        {sideQuestions.map((sq) => (
          <SideQuestionPanel key={sq.id} sq={sq} onDismiss={onDismissSideQuestion} />
        ))}

        {/* Steered / shell transient indicators */}
        <ShellNoticeBar steered={steered} shellNotice={shellNotice} />

        {/* Input box */}
        <ComposerInput
          busy={busy}
          setupReady={setupReady}
          editDraft={editDraft}
          starterDraft={starterDraft}
          onSend={onSend}
          onAbort={onAbort}
          onSteer={onSteer}
          onQueueFollowUp={onQueueFollowUp}
          onClearFollowUps={onClearFollowUps}
          onPopFollowUp={onPopFollowUp}
          onSideQuestion={onSideQuestion}
          onShell={onShell}
          onSetName={onSetName}
        />

        {/* Pending follow-up chips below the input */}
        {followUps.length > 0 ? <FollowUpQueue followUps={followUps} /> : null}

        {/* Footer hints */}
        <div className="composer-footer">
          <div className="composer-hints">
            <Kbd>Enter</Kbd>
            <Text variant="micro" tone="dim">
              {busy ? "steer" : "send"}
            </Text>
            <Kbd>Alt</Kbd>
            <Kbd>Enter</Kbd>
            <Text variant="micro" tone="dim">
              follow-up
            </Text>
            <Kbd>@</Kbd>
            <Text variant="micro" tone="dim">
              file
            </Text>
            <Kbd>!</Kbd>
            <Text variant="micro" tone="dim">
              shell
            </Text>
            <Kbd>Shift</Kbd>
            <Text variant="micro" tone="dim">
              + Enter newline
            </Text>
          </div>
          <Text variant="micro" tone="dim" mono>
            {busy ? "streaming…" : setupReady ? "ready" : "setup required"}
          </Text>
        </div>
      </div>
    </div>
  );
}
