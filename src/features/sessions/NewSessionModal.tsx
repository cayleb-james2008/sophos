// NewSessionModal — create a fresh agent session with an optional working
// directory and goal. Wired to the IPC client's newSession().

import { useState } from "react";
import { tokens } from "../../design/tokens";
import { Modal, Button, Input, TextArea, Text } from "../../design";
import { useIpc } from "../../ipc/client";

export function NewSessionModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const ipc = useIpc();
  const [cwd, setCwd] = useState("");
  const [goal, setGoal] = useState("");
  const [busy, setBusy] = useState(false);

  const create = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await ipc.newSession(cwd.trim() || undefined, goal.trim() || undefined);
      setCwd("");
      setGoal("");
      onCreated();
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New session"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={create} loading={busy}>
            Create session
          </Button>
        </>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: tokens.space.lg }}>
        <Input
          label="Working directory"
          value={cwd}
          onChange={(e) => setCwd(e.target.value)}
          placeholder="C:\work\project"
          hint="Optional — defaults to the daemon's working directory"
        />
        <TextArea
          label="Goal"
          value={goal}
          onChange={(e) => setGoal(e.target.value)}
          placeholder="What should this session accomplish?"
        />
        <Text variant="micro" tone="dim">
          The session starts fresh and can be resumed or forked later from the session manager.
        </Text>
      </div>
    </Modal>
  );
}
