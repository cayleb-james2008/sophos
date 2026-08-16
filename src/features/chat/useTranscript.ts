// useTranscript — transcript slice: messages, load, edit/resend, retry, demo
// seed, bridge publish, streaming events. useChat owns busy/error.

import { useCallback, useEffect, useRef, useState } from "react";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import { useIpc, useIpcEvent, isTauri } from "../../ipc/client";
import type { SessionEvent, ToolCall, TranscriptMessage } from "../../ipc/contract";
import type { AgentProfile } from "../profiles/profiles";
// Demo helpers — DEV-only, tree-shaken in production (import.meta.env.DEV).
import { demoSeedLarge, simulateResponse } from "./demo";
import { setTranscriptMessages } from "./chatBridge";

const nowIso = () => new Date().toISOString();

/** The live display flavor of the active profile — rides on demo prompts so
 * simulation follows the studio draft even before Save (additive; the bridge
 * strips it before the daemon). */
function profileFlavorOf(profile: AgentProfile): { name: string; tagline: string; workingStyle: string[]; mode: string } {
  return { name: profile.name, tagline: profile.tagline, workingStyle: profile.workingStyle ?? [], mode: profile.mode };
}
const userMsg = (content: string): TranscriptMessage => ({ id: `u-${Date.now()}`, role: "user", content, timestamp: nowIso(), status: "complete" });

/** Flatten the daemon message content into text / thinking / toolCalls. */
function parseContentBlocks(content: unknown): { text: string; thinking: string; toolCalls: ToolCall[] } {
  let text = "";
  let thinking = "";
  const toolCalls: ToolCall[] = [];
  if (Array.isArray(content)) {
    for (const part of content) {
      if (part && typeof part === "object") {
        const p = part as Record<string, unknown>;
        if (p.type === "text" && typeof p.text === "string") text += p.text;
        else if (p.type === "thinking" && typeof p.thinking === "string") thinking += p.thinking;
        else if (p.type === "toolCall") toolCalls.push({ id: typeof p.id === "string" ? p.id : `tc-${Date.now()}-${toolCalls.length}`, name: typeof p.name === "string" ? p.name : "tool", input: typeof p.arguments === "string" ? p.arguments : p.arguments !== undefined ? JSON.stringify(p.arguments) : undefined, status: "running" as const });
      }
    }
  } else if (typeof content === "string") text = content;
  return { text, thinking, toolCalls };
}

/** Locate the streaming assistant message, or append via `create()` if none. */
function streamInto(msgs: TranscriptMessage[], id: string | null, update: (m: TranscriptMessage) => TranscriptMessage, create?: () => TranscriptMessage): TranscriptMessage[] {
  const target = msgs.find((m) => m.id === id) ?? [...msgs].reverse().find((m) => m.role === "assistant");
  if (!target) return create ? [...msgs, create()] : msgs;
  return msgs.map((m) => (m.id === target.id ? update(m) : m));
}

interface TranscriptCtx {
  setMessages: Dispatch<SetStateAction<TranscriptMessage[]>>;
  streamingId: MutableRefObject<string | null>;
  demoFixture: MutableRefObject<boolean>;
  setBusy: (b: boolean) => void;
  setError: (e: string | null) => void;
}

/** Apply a daemon session event to the transcript slice. */
function applySessionEvent(evt: SessionEvent, ctx: TranscriptCtx): void {
  const kind = evt.kind;
  const e = evt as unknown as Record<string, unknown>;
  const { setMessages, streamingId, demoFixture, setBusy, setError } = ctx;
  const sid = streamingId.current;
  const a = (): TranscriptMessage => ({ id: `a-${Date.now()}`, role: "assistant", content: "", timestamp: nowIso(), status: "streaming" });

  if (kind === "user_message") {
    const text = typeof e.text === "string" ? e.text : "";
    if (!text) return;
    demoFixture.current = false;
    setMessages((m) => [...m, userMsg(text)]);
    setBusy(true);
  } else if (kind === "message_delta" || kind === "message") {
    demoFixture.current = false;
    const p = parseContentBlocks((e.message as Record<string, unknown> | undefined)?.content ?? e.content);
    setMessages((m) => streamInto(m, sid, (x) => ({ ...x, content: x.content ? x.content : p.text, thinking: p.thinking || x.thinking, toolCalls: p.toolCalls.length ? p.toolCalls : x.toolCalls, status: "streaming" }), () => ({ ...a(), content: p.text, thinking: p.thinking || undefined, toolCalls: p.toolCalls.length ? p.toolCalls : undefined })));
  } else if (kind === "text") {
    demoFixture.current = false;
    const text = typeof e.text === "string" ? e.text : "";
    if (!text) return;
    setMessages((m) => streamInto(m, sid, (x) => ({ ...x, content: `${x.content}${text}` }), () => ({ ...a(), content: text })));
  } else if (kind === "thinking" || kind === "thinking_delta") {
    const text = typeof e.thinking === "string" ? e.thinking : typeof e.text === "string" ? e.text : "";
    if (!text) return;
    setMessages((m) => streamInto(m, sid, (x) => ({ ...x, thinking: `${x.thinking ?? ""}${text}` })));
  } else if (kind === "tool_call" || kind === "tool_use") {
    const name = typeof e.name === "string" ? e.name : typeof e.toolName === "string" ? e.toolName : "tool";
    const input = typeof e.input === "string" ? e.input : e.input !== undefined ? JSON.stringify(e.input) : undefined;
    setMessages((m) => streamInto(m, sid, (x) => ({ ...x, toolCalls: [...(x.toolCalls ?? []), { id: `tc-${Date.now()}`, name, input, status: "running" as const }] })));
  } else if (kind === "tool_result" || kind === "tool_output") {
    const output = typeof e.output === "string" ? e.output : e.output !== undefined ? JSON.stringify(e.output) : undefined;
    const name = typeof e.name === "string" ? e.name : typeof e.toolName === "string" ? e.toolName : undefined;
    setMessages((m) => streamInto(m, sid, (x) => ({ ...x, toolCalls: (x.toolCalls ?? []).map((tc, i) => (name ? tc.name === name : i === (x.toolCalls?.length ?? 1) - 1) ? { ...tc, output, status: "complete" as const } : tc) })));
  } else if (kind === "error") {
    const text = typeof e.message === "string" ? e.message : typeof e.error === "string" ? e.error : "An error occurred";
    setMessages((m) => m.map((x) => (x.id === sid ? { ...x, status: "error" as const } : x)));
    setError(text);
    setBusy(false);
    streamingId.current = null;
  }
}

export interface TranscriptOptions {
  setBusy: (busy: boolean) => void;
  setError: (error: string | null) => void;
  busyRef: MutableRefObject<boolean>;
}

export function useTranscript({ setBusy, setError, busyRef }: TranscriptOptions) {
  const client = useIpc();
  const [messages, setMessages] = useState<TranscriptMessage[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [editDraft, setEditDraft] = useState<{ index: number; text: string } | null>(null);
  const editDraftRef = useRef<{ index: number; text: string } | null>(null);
  const simCleanup = useRef<(() => void) | null>(null);
  const streamingId = useRef<string | null>(null);
  const demoFixture = useRef(false);

  // ---- Initial transcript load ----
  useEffect(() => {
    let mounted = true;
    client.getTranscript().then((t) => { if (mounted) { setMessages(t); setLoaded(true); } }).catch(() => { if (mounted) setLoaded(true); });
    return () => { mounted = false; };
  }, [client]);

  // ---- Publish to the shared bridge (⌘K palette search) ----
  useEffect(() => { setTranscriptMessages(messages); }, [messages]);

  // ---- First-message flag persisted so onboarding completes across reloads ----
  const hasFirstMessage = messages.length > 0 && !demoFixture.current;
  useEffect(() => { if (hasFirstMessage) { try { window.localStorage.setItem("sophos.hasFirstMessage.v1", "1"); } catch { /* best-effort */ } } }, [hasFirstMessage]);

  // ---- Cleanup simulation on unmount ----
  useEffect(() => () => { simCleanup.current?.(); }, []);

  // ---- Live IPC: transcript-affecting session events ----
  useIpcEvent((event) => { if (event.type === "session_event") applySessionEvent(event.event, { setMessages, streamingId, demoFixture, setBusy, setError }); });

  const requestEdit = useCallback((index: number, text: string) => {
    const draft = { index, text };
    editDraftRef.current = draft;
    setEditDraft(draft);
  }, []);

  const editAndResend = useCallback((index: number, newText: string, profile?: AgentProfile) => {
    const trimmed = newText.trim();
    if (!trimmed) return;
    demoFixture.current = false;
    busyRef.current = true;
    setMessages((msgs) => [...msgs.slice(0, index), userMsg(trimmed)]);
    setBusy(true);
    setError(null);
    if (isTauri) {
      void (profile ? client.prompt(trimmed, { profile: profile.id, profileFlavor: profileFlavorOf(profile) }) : client.prompt(trimmed)).catch((err) => { setError(err instanceof Error ? err.message : String(err)); setBusy(false); });
      return;
    }
    if (import.meta.env.DEV) {
      simCleanup.current?.();
      simCleanup.current = simulateResponse(trimmed, { onUpdate: (u) => setMessages(u), onDone: () => { setBusy(false); streamingId.current = null; } }, profile);
    }
  }, [client, setBusy, setError, busyRef]);

  const retry = useCallback((message: TranscriptMessage, profile?: AgentProfile) => {
    const idx = messages.findIndex((m) => m.id === message.id);
    if (idx < 0) return;
    let userText: string | null = null;
    for (let i = idx - 1; i >= 0; i--) { if (messages[i].role === "user") { userText = messages[i].content; break; } }
    if (!userText) return;
    demoFixture.current = false;
    if (isTauri) {
      void client.retry().catch((err) => { setError(err instanceof Error ? err.message : String(err)); });
      return;
    }
    setError(null);
    setBusy(true);
    if (import.meta.env.DEV) {
      simCleanup.current?.();
      simCleanup.current = simulateResponse(userText, { onUpdate: (u) => setMessages(u), onDone: () => { setBusy(false); streamingId.current = null; } }, profile);
    }
  }, [messages, client, setBusy, setError]);

  const loadDemoMessages = useCallback((count = 500) => {
    demoFixture.current = true;
    if (import.meta.env.DEV) setMessages(demoSeedLarge(count));
  }, []);

  /** Execute a turn: append (or branch from) a user message and stream a response. */
  const runTurn = useCallback(async (text: string, branchFrom?: number, profile?: AgentProfile): Promise<void> => {
    const trimmed = text.trim();
    if (!trimmed) return;
    demoFixture.current = false;
    busyRef.current = true;
    setError(null);
    setMessages((msgs) => (branchFrom != null ? [...msgs.slice(0, branchFrom), userMsg(trimmed)] : [...msgs, userMsg(trimmed)]));
    setBusy(true);
    if (isTauri) {
      try { await (profile ? client.prompt(trimmed, { profile: profile.id, profileFlavor: profileFlavorOf(profile) }) : client.prompt(trimmed)); } catch (err) { setError(err instanceof Error ? err.message : String(err)); setBusy(false); }
      return;
    }
    if (import.meta.env.DEV) {
      simCleanup.current?.();
      simCleanup.current = simulateResponse(trimmed, { onUpdate: (u) => setMessages(u), onDone: () => { setBusy(false); streamingId.current = null; } }, profile);
    }
  }, [client, setBusy, setError, busyRef]);

  return {
    messages, loaded, hasFirstMessage, editDraft, setMessages, setEditDraft, editDraftRef, streamingId, simCleanup,
    requestEdit, editAndResend, retry, loadDemoMessages, runTurn,
  };
}
