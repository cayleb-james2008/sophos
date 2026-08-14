// useSideQuestions — owns the inline side-question panel state (/btw, /side).
// Handles the side_question_event stream and the ask/dismiss actions.

import { useCallback, useState } from "react";
import { useIpc, useIpcEvent, isTauri } from "../../ipc/client";

export type SideQuestionStatus = "running" | "complete" | "cancelled" | "error";

export interface SideQuestion {
  id: string;
  kind: "btw" | "side";
  question: string;
  status: SideQuestionStatus;
  answer: string;
}

function normalizeSideStatus(raw: unknown): SideQuestionStatus {
  const s = String(raw ?? "");
  if (s === "complete" || s === "cancelled" || s === "error") return s;
  return "running";
}

export function useSideQuestions() {
  const client = useIpc();
  const [sideQuestions, setSideQuestions] = useState<SideQuestion[]>([]);

  // ---- Live IPC: side-question status updates ----
  useIpcEvent((event) => {
    if (event.type !== "session_event") return;
    const evt = event.event;
    if (evt.kind !== "side_question_event") return;
    const e = evt as unknown as Record<string, unknown>;
    const id = typeof e.id === "string" ? e.id : "";
    if (!id) return;
    setSideQuestions((sqs) => sqs.map((sq) => (sq.id === id ? { ...sq, status: normalizeSideStatus(e.status) } : sq)));
  });

  const askSideQuestion = useCallback(
    (kind: "btw" | "side", question: string) => {
      const q = question.trim();
      if (!q) return;
      const id = `side-${Date.now()}`;
      setSideQuestions((sqs) => [...sqs, { id, kind, question: q, status: "running", answer: "" }]);
      // Fire the real IPC (a no-op in browser mode) via the dedicated RPC.
      void client.startSideQuestion(q).catch(() => {
        // best-effort — the panel still reflects local state
      });
      // In the browser preview there is no live engine to reply, so simulate a
      // short side turn so the panel is demonstrable without Tauri.
      if (!isTauri) {
        window.setTimeout(() => {
          setSideQuestions((sqs) =>
            sqs.map((sq) =>
              sq.id === id
                ? {
                    ...sq,
                    status: "complete",
                    answer: `Side reply (demo preview) — no live engine connected.\n\nYour side question: “${q}”. In the connected app this opens an inline side conversation that doesn't touch the main session.`,
                  }
                : sq,
            ),
          );
        }, 1300);
      }
    },
    [client],
  );

  const dismissSideQuestion = useCallback((id: string) => {
    setSideQuestions((sqs) => sqs.filter((sq) => sq.id !== id));
  }, []);

  return { sideQuestions, askSideQuestion, dismissSideQuestion };
}
