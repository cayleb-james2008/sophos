// useSessionEvent — subscribe to session_event IPC events and surface only the
// kinds this feature cares about (e.g. the daemon's `tree` / `context_tree`
// responses from the `/tree` navigation command). Returns the latest matching
// event plus a monotonically increasing `version` so callers can re-run an
// effect (e.g. reload the transcript after a tree navigation) exactly once per
// event.

import { useRef, useState } from "react";
import { useIpcEvent } from "../../ipc/client";
import type { SessionEvent } from "../../ipc/contract";

export function useSessionEvent(kinds: string[]) {
  const [event, setEvent] = useState<SessionEvent | undefined>(undefined);
  const [version, setVersion] = useState(0);
  const kindsRef = useRef(kinds);
  kindsRef.current = kinds;

  useIpcEvent((ipcEvent) => {
    if (ipcEvent.type !== "session_event") return;
    const e = ipcEvent.event;
    if (e && kindsRef.current.includes(e.kind)) {
      setEvent(e);
      setVersion((v) => v + 1);
    }
  });

  return { event, version };
}
