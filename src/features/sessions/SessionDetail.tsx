// SessionDetail — the right-hand detail pane for the selected session. On open
// loads the transcript (getTranscript), context stats (getContextStats), goals +
// RLM children (getState), and surfaces them alongside session metadata and the
// primary actions.
//
// Session-management parity (P2):
//  - Editable title (inline rename via setSessionName(name))
//  - Clone (cloneSession) from the header
//  - Fork-from-here on each user message (forkSession(messageId))
//  - Compact with optional custom prompt (compact(prompt?)) + compaction status (ContextStats.compaction)
//  - Enriched context ring, RLM children, goals, and session stats

import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Text, Badge, Modal, TextArea } from "../../design";
import { tokens } from "../../design/tokens";
import type {
  SessionInfo,
  TranscriptMessage,
  ContextStats,
  Goal,
  RlmChild,
} from "../../ipc/contract";
import { useIpc } from "../../ipc/client";
import { formatDate, formatTokens, initials, durationLabel, relativeTime } from "./format";
import { ContextRing } from "./ContextRing";
import {
  PlayIcon,
  ForkIcon,
  RefreshIcon,
  TargetIcon,
  CpuIcon,
  LayersIcon,
  CloneIcon,
  CompactIcon,
  PencilIcon,
  CheckIcon,
  XIcon,
} from "./icons";
import "./sessions.css";

export function SessionDetail({
  session,
  onSwitch,
  onResume,
  onFork,
}: {
  session: SessionInfo;
  onSwitch: () => void;
  onResume: () => void;
  onFork: () => void;
}) {
  const ipc = useIpc();
  const status = session.status ?? "idle";
  const statusLabel = status === "active" ? "Active" : status === "saved" ? "Saved" : "Background";

  const [transcript, setTranscript] = useState<TranscriptMessage[]>([]);
  const [context, setContext] = useState<ContextStats | undefined>();
  const [goals, setGoals] = useState<Goal[]>([]);
  const [rlmChildren, setRlmChildren] = useState<RlmChild[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>();

  // Title (inline rename)
  const [title, setTitle] = useState(session.title || session.id);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState(session.title || session.id);

  // Compact
  const [compactOpen, setCompactOpen] = useState(false);
  const [compactPrompt, setCompactPrompt] = useState("");
  const [compacting, setCompacting] = useState(false);
  const [compactError, setCompactError] = useState<string | undefined>();

  // Fork-from-here inline confirm
  const [forkConfirmId, setForkConfirmId] = useState<string | null>(null);

  // Toast
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<number | undefined>(undefined);

  const showToast = (msg: string) => {
    setToast(msg);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 2600);
  };
  useEffect(() => () => window.clearTimeout(toastTimer.current), []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(undefined);
    try {
      const [tx, ctx, state] = await Promise.all([
        ipc.getTranscript().catch(() => [] as TranscriptMessage[]),
        ipc.getContextStats().catch(() => undefined),
        ipc.getState().catch(() => undefined),
      ]);
      setTranscript(tx);
      setContext(ctx);
      setGoals(state?.goals ?? []);
      setRlmChildren(state?.rlmChildren ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to load session detail");
    } finally {
      setLoading(false);
    }
  }, [ipc]);

  useEffect(() => {
    void load();
  }, [load, session.id]);

  // Keep the displayed title in sync with the session object.
  useEffect(() => {
    setTitle(session.title || session.id);
    setTitleDraft(session.title || session.id);
  }, [session.id, session.title]);

  const startRename = () => {
    setTitleDraft(title);
    setEditingTitle(true);
  };

  const saveTitle = async () => {
    const value = titleDraft.trim();
    setEditingTitle(false);
    if (!value || value === title) return;
    try {
      await ipc.setSessionName(value);
      setTitle(value);
      showToast("Session renamed");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Rename failed");
    }
  };

  const clone = async () => {
    try {
      await ipc.cloneSession();
      showToast("Session cloned — a new copy is on the way.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Clone failed");
    }
  };

  const runCompact = async () => {
    if (compacting) return;
    setCompacting(true);
    setCompactError(undefined);
    try {
      const prompt = compactPrompt.trim();
      await ipc.compact(prompt || undefined);
      showToast("Compaction requested");
      setCompactOpen(false);
      setCompactPrompt("");
      await load(); // refresh compaction status
    } catch (e) {
      setCompactError(e instanceof Error ? e.message : "Compaction failed");
    } finally {
      setCompacting(false);
    }
  };

  const forkFrom = async (messageId: string) => {
    setForkConfirmId(null);
    try {
      await ipc.forkSession(messageId);
      showToast("Forked — new session created from this message.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Fork failed");
    }
  };

  const contextPct =
    context?.tokens != null && context?.contextWindow
      ? Math.min(100, Math.round((context.tokens / context.contextWindow) * 100))
      : undefined;

  const compactState = context?.compaction?.lastCompactedAt
    ? `Last compacted ${relativeTime(context.compaction.lastCompactedAt)}${context.compaction.reason ? ` · ${context.compaction.reason}` : ""}`
    : "No prior compaction recorded";

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      {/* Head */}
      <div className="detail__head">
        <div className="detail__avatar">
          {initials(title)}
          <i className={`status status--${status}`} />
        </div>
        <div className="detail__title">
          {editingTitle ? (
            <input
              className="detail__title-input"
              autoFocus
              value={titleDraft}
              onChange={(e) => setTitleDraft(e.target.value)}
              onBlur={() => void saveTitle()}
              onKeyDown={(e) => {
                if (e.key === "Enter") void saveTitle();
                if (e.key === "Escape") setEditingTitle(false);
              }}
            />
          ) : (
            <button className="detail__title-edit" onClick={startRename} title="Rename session">
              <b>{title}</b>
              <PencilIcon size={11} />
            </button>
          )}
          <span>
            <i className={`status status--${status}`} /> {statusLabel} · session {session.id}
          </span>
        </div>
        <div className="detail__id">SESSION / {session.id.slice(0, 8).toUpperCase()}</div>
        <Button variant="outline" size="sm" icon={<CloneIcon size={13} />} onClick={() => void clone()}>
          Clone
        </Button>
      </div>

      {/* Body */}
      <div className="detail__body">
        {error && (
          <div className="detail__error" role="alert">
            <Text variant="micro" tone="danger">
              ✕ {error}
            </Text>
            <button className="detail__retry" onClick={() => void load()}>
              Retry
            </button>
          </div>
        )}

        {/* Context usage */}
        <section className="detail__section">
          <SectionHeader icon={<CpuIcon size={12} />} label="Context usage" />
          {loading ? (
            <div className="detail__skeleton" />
          ) : contextPct != null ? (
            <div className="context-block">
              <ContextRing tokens={context?.tokens} contextWindow={context?.contextWindow} messages={context?.messages} />
              <div className="context-block__meta">
                <span>
                  <b>{formatTokens(context?.tokens)}</b> / {formatTokens(context?.contextWindow)} tokens
                </span>
                <span>
                  <b>{contextPct}%</b> of context window used
                </span>
                {context?.messages != null && <span>{context.messages} messages in context</span>}
              </div>
            </div>
          ) : (
            <Text variant="micro" tone="dim">
              No context data available
            </Text>
          )}
          {context?.compaction?.reason && (
            <div className="context-meter__compaction">{compactState}</div>
          )}
        </section>

        {/* Goals */}
        <section className="detail__section">
          <SectionHeader icon={<TargetIcon size={12} />} label="Goals" count={goals.length} />
          {loading ? (
            <div className="detail__skeleton" />
          ) : goals.length > 0 ? (
            <div className="goals">
              {goals.map((g) => (
                <div key={g.id} className="goal">
                  <div className="goal__status">
                    <GoalStatusDot status={g.status} />
                  </div>
                  <div className="goal__body">
                    <b>{g.objective}</b>
                    {g.progress && <small>{g.progress}</small>}
                  </div>
                  <Badge tone={goalTone(g.status)}>{g.status}</Badge>
                </div>
              ))}
            </div>
          ) : (
            <Text variant="micro" tone="dim">
              No active goals
            </Text>
          )}
        </section>

        {/* RLM children */}
        <section className="detail__section">
          <SectionHeader icon={<LayersIcon size={12} />} label="RLM children" count={rlmChildren.length} />
          {loading ? (
            <div className="detail__skeleton" />
          ) : rlmChildren.length > 0 ? (
            <div className="rlm-children">
              {rlmChildren.map((child) => (
                <div key={child.id} className="rlm-child">
                  <div className="rlm-child__avatar">
                    {initials(child.name)}
                    <i className={`status status--${rlmStatusToClass(child.status)}`} />
                  </div>
                  <div className="rlm-child__meta">
                    <b>{child.name || child.id.slice(0, 12)}</b>
                    <small>{child.status}{child.summary ? ` · ${child.summary}` : ""}</small>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <Text variant="micro" tone="dim">
              No active subagents
            </Text>
          )}
        </section>

        {/* Transcript */}
        <section className="detail__section">
          <SectionHeader icon={<RefreshIcon size={12} />} label="Transcript" count={transcript.length} />
          {loading ? (
            <div className="detail__skeleton" />
          ) : transcript.length > 0 ? (
            <div className="transcript">
              {transcript.map((msg) => (
                <TranscriptRow
                  key={msg.id}
                  msg={msg}
                  forkConfirm={forkConfirmId === msg.id}
                  onForkRequest={() => setForkConfirmId(msg.id)}
                  onCancelFork={() => setForkConfirmId(null)}
                  onConfirmFork={() => void forkFrom(msg.id)}
                />
              ))}
            </div>
          ) : (
            <Text variant="micro" tone="dim">
              No transcript available
            </Text>
          )}
        </section>

        {/* Session metadata */}
        <section className="detail__section">
          <SectionHeader icon={<PlayIcon size={12} />} label="Session info" />
          <div className="detail__metadata">
            <Row label="Working directory" value={session.cwd || "—"} />
            <Row label="Messages in context" value={context?.messages != null ? String(context.messages) : "—"} />
            <Row label="Tokens in context" value={formatTokens(context?.tokens)} />
            <Row label="Created" value={formatDate(session.createdAt)} />
            <Row label="Last updated" value={formatDate(session.updatedAt)} />
            <Row label="Duration" value={durationLabel(session.createdAt, session.updatedAt)} />
          </div>
        </section>
      </div>

      {/* Actions */}
      <div className="detail__actions">
        <Button variant="primary" icon={<PlayIcon size={14} />} onClick={onSwitch}>
          Switch
        </Button>
        <Button variant="accent-soft" icon={<RefreshIcon size={14} />} onClick={onResume}>
          Resume
        </Button>
        <Button variant="outline" icon={<ForkIcon size={14} />} onClick={onFork}>
          Fork
        </Button>
        <Button variant="outline" icon={<CompactIcon size={14} />} onClick={() => setCompactOpen(true)}>
          Compact
        </Button>
      </div>

      {toast && (
        <div className="detail__toast" role="status">
          <span>✓ {toast}</span>
        </div>
      )}

      {/* Compact modal */}
      <Modal
        open={compactOpen}
        onClose={() => setCompactOpen(false)}
        title="Compact session"
        footer={
          <>
            <Button variant="ghost" onClick={() => setCompactOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" icon={<CompactIcon size={14} />} onClick={() => void runCompact()} loading={compacting}>
              Compact now
            </Button>
          </>
        }
      >
        <div style={{ display: "flex", flexDirection: "column", gap: tokens.space.lg }}>
          <div className="compact-status">
            <span className={`compact-status__dot${compacting ? " compact-status__dot--active" : ""}`} />
            <div>
              <b>{compacting ? "Compacting…" : "Compaction idle"}</b>
              <small>{compactState}</small>
            </div>
          </div>
          <TextArea
            label="Custom compaction prompt (optional)"
            value={compactPrompt}
            onChange={(e) => setCompactPrompt(e.target.value)}
            placeholder="e.g. focus on the auth refactor, remember the exact migration command"
          />
          <Text variant="micro" tone="dim">
            Leave blank to use the default summarization prompt.
          </Text>
          {compactError && (
            <Text variant="micro" tone="danger">
              ✕ {compactError}
            </Text>
          )}
        </div>
      </Modal>
    </div>
  );
}

function SectionHeader({ icon, label, count }: { icon: React.ReactNode; label: string; count?: number }) {
  return (
    <div className="detail__sectionhead">
      <span className="detail__sectionicon">{icon}</span>
      <span className="detail__sectionlabel">{label}</span>
      {count != null && <span className="detail__sectioncount">{count}</span>}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="detail__row">
      <label>{label}</label>
      <span>{value}</span>
    </div>
  );
}

function GoalStatusDot({ status }: { status: Goal["status"] }) {
  const color =
    status === "active" ? tokens.color.ok : status === "completed" ? tokens.color.info : status === "paused" ? tokens.color.warn : tokens.color.textDim;
  return <span className="goal__dot" style={{ background: color }} />;
}

function goalTone(status: Goal["status"]): "success" | "accent" | "warning" | "neutral" {
  switch (status) {
    case "active":
      return "success";
    case "completed":
      return "accent";
    case "paused":
      return "warning";
    default:
      return "neutral";
  }
}

function rlmStatusToClass(status: RlmChild["status"]): string {
  switch (status) {
    case "running":
      return "active";
    case "done":
      return "saved";
    case "error":
      return "idle";
    default:
      return "idle";
  }
}

function TranscriptRow({
  msg,
  forkConfirm,
  onForkRequest,
  onCancelFork,
  onConfirmFork,
}: {
  msg: TranscriptMessage;
  forkConfirm: boolean;
  onForkRequest: () => void;
  onCancelFork: () => void;
  onConfirmFork: () => void;
}) {
  const roleLabel =
    msg.role === "assistant" ? "ASSISTANT" : msg.role === "user" ? "USER" : msg.role === "tool" ? "TOOL" : "SYSTEM";
  const roleClass = `transcript__role${msg.role === "assistant" ? "--assistant" : msg.role === "user" ? "--user" : "--system"}`;
  const isUser = msg.role === "user";
  return (
    <article className="transcript__row">
      <div className={roleClass}>{roleLabel}</div>
      <div className="transcript__content">
        <span className="transcript__time">
          {msg.timestamp ? relativeTime(msg.timestamp) : ""}
          {isUser && (
            <button className="transcript__fork" title="Fork a new session from this message" onClick={onForkRequest}>
              <ForkIcon size={10} /> Fork from here
            </button>
          )}
        </span>
        {forkConfirm && (
          <div className="transcript__forkconfirm">
            <span>Fork a new session from this point?</span>
            <button className="transcript__forkconfirm-yes" onClick={onConfirmFork}>
              <CheckIcon size={11} /> Fork
            </button>
            <button className="transcript__forkconfirm-no" onClick={onCancelFork}>
              <XIcon size={11} /> Cancel
            </button>
          </div>
        )}
        <p className="transcript__text">{msg.content}</p>
        {msg.thinking && (
          <div className="transcript__thinking">
            <span className="transcript__thinking-label">thinking</span>
            <p>{msg.thinking}</p>
          </div>
        )}
        {msg.toolCalls && msg.toolCalls.length > 0 && (
          <div className="transcript__tools">
            {msg.toolCalls.map((tc) => (
              <div key={tc.id} className="transcript__tool">
                <span className="transcript__tool-name">{tc.name}</span>
                {tc.status && <span className={`transcript__tool-status transcript__tool-status--${tc.status}`}>{tc.status}</span>}
              </div>
            ))}
          </div>
        )}
      </div>
    </article>
  );
}
