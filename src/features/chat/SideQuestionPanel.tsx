// SideQuestionPanel — inline side-question result shown above the composer.

import { useState } from "react";
import { tokens } from "../../design/tokens";
import { Text, StatusDot, Button, IconButton } from "../../design";
import type { SideQuestion, SideQuestionStatus } from "./useChat";
import { ChevronIcon, XSmall } from "./chatIcons";

const sideStatusMeta: Record<SideQuestionStatus, { tone: "success" | "warning" | "danger" | "info"; label: string; dot: "connected" | "connecting" | "disconnected" | "idle" }> = {
  running: { tone: "info", label: "running", dot: "connecting" },
  complete: { tone: "success", label: "complete", dot: "connected" },
  cancelled: { tone: "warning", label: "cancelled", dot: "idle" },
  error: { tone: "danger", label: "error", dot: "disconnected" },
};

export function SideQuestionPanel({
  sq,
  onDismiss,
}: {
  sq: SideQuestion;
  onDismiss: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const meta = sideStatusMeta[sq.status];
  return (
    <div className="side-question">
      <div className="side-question-header">
        <StatusDot state={meta.dot} size={6} pulse={sq.status === "running"} />
        <Text variant="micro" tone="accent" mono uppercase className="side-question-kicker">
          /{sq.kind}
        </Text>
        <Text variant="micro" tone="muted" mono uppercase>
          {meta.label}
        </Text>
        <div className="side-question-spacer" />
        <Button
          variant="ghost"
          type="button"
          onClick={() => setOpen((o) => !o)}
          title={open ? "Hide reply" : "Show reply"}
          aria-label={open ? "Hide reply" : "Show reply"}
          className="side-question-reply-btn"
        >
          <Text variant="micro" tone="dim">
            reply
          </Text>
          <ChevronIcon open={open} color={tokens.color.textDim} />
        </Button>
        <IconButton
          title="Dismiss side question"
          onClick={() => onDismiss(sq.id)}
          className="side-question-dismiss"
        >
          <XSmall color={tokens.color.textDim} />
        </IconButton>
      </div>
      <Text variant="body" tone="default" className="side-question-question">
        {sq.question}
      </Text>
      {open ? (
        <div className="side-question-answer">
          {sq.answer || (sq.status === "running" ? "Thinking…" : `No reply recorded (${sq.status}).`)}
        </div>
      ) : null}
    </div>
  );
}
