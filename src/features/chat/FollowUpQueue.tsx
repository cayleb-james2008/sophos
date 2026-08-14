// FollowUpQueue — pending follow-up chips shown below the composer input.

import { Text } from "../../design";
import type { FollowUp } from "./useChat";

export function FollowUpQueue({ followUps }: { followUps: FollowUp[] }) {
  return (
    <div className="followup-queue">
      {followUps.map((f) => (
        <span
          key={f.id}
          title={f.text}
          className="followup-chip"
        >
          <span className="followup-arrow">↪</span>
          <span className="followup-text">
            {f.text}
          </span>
        </span>
      ))}
      <Text variant="micro" tone="dim">
        queued · Alt+Up to retrieve · Esc to clear
      </Text>
    </div>
  );
}
