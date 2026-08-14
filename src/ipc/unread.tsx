// Cross-view unread badge state for the sidebar Inbox nav item.
//
// This is a neutral, IPC-derived concern (lives in src/ipc) so the shell
// never has to depend on a feature package. It does ONE listInbox load on
// mount and subscribes to `agent_message` events to stay live. It only ever
// tracks a count — the detailed message state is owned by the Agents / Inbox
// views themselves. Degrades silently when the daemon is unavailable.

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { useIpc, useIpcEvent } from "./client";
import type { AgentMessage } from "./contract";

const SELF = "self";

interface UnreadState {
  count: number;
  refresh: () => void;
}

const UnreadContext = createContext<UnreadState | undefined>(undefined);

export function UnreadProvider({ children }: { children: ReactNode }) {
  const ipc = useIpc();
  const [count, setCount] = useState(0);

  const refresh = useCallback(async () => {
    try {
      const inbox = await ipc.listInbox();
      setCount((inbox ?? []).filter(incomingUnread).length);
    } catch {
      // Daemon unreachable / wedge — badge simply stays at zero.
      setCount(0);
    }
  }, [ipc]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useIpcEvent((event) => {
    if (event.type === "agent_message") {
      if (incomingUnread(event.message)) {
        setCount((c) => c + 1);
      }
    } else if (event.type === "agent_list") {
      void refresh();
    }
  });

  return <UnreadContext.Provider value={{ count, refresh }}>{children}</UnreadContext.Provider>;
}

function incomingUnread(m: AgentMessage): boolean {
  return m.fromAgentId !== SELF && m.read !== true;
}

/** Hook for the sidebar nav badge. Returns 0 outside a provider. */
export function useUnreadBadge(): number {
  return useContext(UnreadContext)?.count ?? 0;
}

/** Refresh the global unread count. Call after marking messages read so the
 *  sidebar badge stays in sync (the IPC contract has no message_read event, so
 *  the provider can only re-derive the count from listInbox). */
export function useUnreadRefresh(): (() => void) | undefined {
  const ctx = useContext(UnreadContext);
  return ctx ? ctx.refresh : undefined;
}
