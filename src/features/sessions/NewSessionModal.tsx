// NewSessionModal — create a fresh agent session with an optional working
// directory and goal. Wired to the IPC client's newSession(). Supports a
// "save as default" working directory so every new session starts in the same
// workflow folder.

import { useEffect, useState } from "react";
import { Modal, Button, Input, TextArea, Text } from "../../design";
import { useIpc, isTauri } from "../../ipc/client";
import { open as openDialog } from "@tauri-apps/plugin-dialog";

// Open a native folder picker via the Tauri dialog plugin. Returns the chosen
// path, or null if not running in Tauri / the user cancelled / the call failed.
async function pickFolder(): Promise<string | null> {
  if (!isTauri) return null;
  try {
    const selected = await openDialog({ directory: true, multiple: false });
    return typeof selected === "string" ? selected : null;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[new-session] folder picker failed:", err);
    return null;
  }
}

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
  const [saveDefault, setSaveDefault] = useState(false);
  const [busy, setBusy] = useState(false);
  const [browseHint, setBrowseHint] = useState(false);

  // Load the saved default working directory when the modal opens.
  useEffect(() => {
    if (!open) return;
    let mounted = true;
    ipc
      .getSettings()
      .then((s) => {
        if (mounted && s?.defaultCwd) setCwd(s.defaultCwd);
      })
      .catch(() => {
        // best-effort — leave the field empty if settings can't be read
      });
    return () => {
      mounted = false;
    };
  }, [open, ipc]);

  const browse = async () => {
    const picked = await pickFolder();
    if (picked) {
      setCwd(picked);
      setBrowseHint(false);
    } else {
      // No dialog plugin — surface a hint to type the path instead.
      setBrowseHint(true);
    }
  };

  const create = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const trimmedCwd = cwd.trim();
      await ipc.newSession(trimmedCwd || undefined, goal.trim() || undefined);
      // Persist the default working directory for future sessions.
      if (saveDefault) {
        try {
          const settings = await ipc.getSettings();
          await ipc.setSettings({ ...settings, defaultCwd: trimmedCwd });
        } catch {
          // best-effort — the session still creates even if persistence fails
        }
      }
      setCwd("");
      setGoal("");
      setSaveDefault(false);
      setBrowseHint(false);
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
      <div className="ns-form">
        <div className="ns-field">
          <Input
            label="Working directory"
            value={cwd}
            onChange={(e) => setCwd(e.target.value)}
            placeholder="C:\work\project"
            hint={browseHint ? "Folder picker unavailable — type the full path instead." : "Where should this session work?"}
          />
          <div className="ns-row">
            <Button variant="outline" size="sm" onClick={browse}>
              Browse…
            </Button>
            <label className="ns-check">
              <input
                type="checkbox"
                checked={saveDefault}
                onChange={(e) => setSaveDefault(e.target.checked)}
                className="ns-checkbox"
              />
              <Text variant="label" tone="muted">
                Save as default for all sessions
              </Text>
            </label>
          </div>
        </div>
        <TextArea
          label="Goal"
          value={goal}
          onChange={(e) => setGoal(e.target.value)}
          placeholder="What should this session accomplish?"
        />
        <Text variant="micro" tone="dim">
          The session starts fresh in the chosen folder and can be resumed or forked later from the session manager.
        </Text>
      </div>
    </Modal>
  );
}
