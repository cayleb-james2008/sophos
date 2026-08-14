// ShellNoticeBar — transient steer / shell indicators above the composer input.

import { Text, StatusDot } from "../../design";

export function ShellNoticeBar({
  steered,
  shellNotice,
}: {
  steered: { text: string; at: number } | null;
  shellNotice: { command: string; hidden: boolean } | null;
}) {
  return (
    <>
      {steered ? (
        <div className="shell-notice">
          <StatusDot state="connected" size={6} />
          <Text variant="micro" tone="accent" mono uppercase>
            steered
          </Text>
          <Text variant="micro" tone="muted" className="shell-notice-text">
            “{steered.text}”
          </Text>
        </div>
      ) : null}
      {shellNotice ? (
        <div className="shell-notice">
          <StatusDot state={shellNotice.hidden ? "idle" : "connected"} size={6} />
          <Text variant="micro" tone={shellNotice.hidden ? "dim" : "info"} mono uppercase>
            {shellNotice.hidden ? "hidden shell" : "shell"}
          </Text>
          <Text variant="micro" tone="muted" mono className="shell-notice-text">
            $ {shellNotice.command}
          </Text>
        </div>
      ) : null}
    </>
  );
}
