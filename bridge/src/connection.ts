// Connection wrapper.
//
// Wraps `DaemonAgentConnection` from the coding-agent package and adapts it to
// the IPC contract (`IpcCommand` / `IpcEvent`) the Rust shell expects.
//
// Responsibilities:
//   * Own the lifecycle of one DaemonAgentConnection (connect, dispose).
//   * Map AgentConnection state → IPC ConnectionState.
//   * Translate AgentConnection events → IPC events and forward them.
//   * Surface a stable, typed surface that `rpc.ts` can dispatch into.
//
// The wrapper does NOT do JSON-RPC framing; that's `rpc.ts`'s job. It only
// knows about the daemon adapter and the contract shapes.

import {
  DaemonAgentConnection,
  DaemonClient,
  defaultDaemonSocketPath,
  type AgentConnection,
  type AgentConnectionEvent,
  type AgentConnectionModel,
  type AgentConnectionSessionEvent,
  type AgentConnectionState,
} from "@earendil-works/pi-coding-agent";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

// ---------------------------------------------------------------------------
// Persistent settings file.
//
// Settings are shared with the Rust shell through ~/.prime/agent/settings.json.
// The bridge owns the user-facing JSON values and keeps the file backward
// compatible by preserving fields it does not interpret.
// ---------------------------------------------------------------------------

const PRIME_AGENT_DIR = join(homedir(), ".prime", "agent");
const SETTINGS_PATH = join(PRIME_AGENT_DIR, "settings.json");
const MODELS_JSON_PATH = join(PRIME_AGENT_DIR, "models.json");

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readSettingsFile(): Record<string, unknown> {
  try {
    if (!existsSync(SETTINGS_PATH)) return {};
    const value: unknown = JSON.parse(readFileSync(SETTINGS_PATH, "utf8"));
    return isRecord(value) ? value : {};
  } catch {
    return {};
  }
}

function parseBoolean(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toLowerCase();
  if (["true", "1", "yes", "on"].includes(normalized)) return true;
  if (["false", "0", "no", "off"].includes(normalized)) return false;
  return undefined;
}

function normalizeModelConfig(value: unknown): Settings["modelConfig"] {
  if (!isRecord(value)) return undefined;
  const result: NonNullable<Settings["modelConfig"]> = {};
  for (const [key, raw] of Object.entries(value)) {
    if (!isRecord(raw)) continue;
    const config: NonNullable<Settings["modelConfig"]>[string] = {};
    if (Number.isSafeInteger(raw.contextWindow) && (raw.contextWindow as number) >= 1024) {
      config.contextWindow = raw.contextWindow as number;
    }
    if (Number.isSafeInteger(raw.maxOutputTokens) && (raw.maxOutputTokens as number) >= 1024) {
      config.maxOutputTokens = raw.maxOutputTokens as number;
    }
    if (Object.keys(config).length > 0) result[key] = config;
  }
  return result;
}

function normalizeString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

const THINKING_LEVELS = new Set(["off", "minimal", "low", "medium", "high", "xhigh", "max"]);
const STRING_SETTING_KEYS = ["shellPath", "sessionDir", "defaultCwd", "defaultProvider", "defaultModel", "defaultThinking", "daemonCliPath"] as const;

function normalizeThinking(value: unknown): string | undefined {
  const thinking = normalizeString(value);
  return thinking && THINKING_LEVELS.has(thinking) ? thinking : undefined;
}

function normalizeStringSetting(key: string, value: unknown): string | undefined {
  return key === "defaultThinking" ? normalizeThinking(value) : normalizeString(value);
}

function normalizeTheme(value: unknown): Settings["theme"] {
  return value === "dark" || value === "light" || value === "system" ? value : undefined;
}

function normalizeSettings(raw: Record<string, unknown>): Settings {
  const out: Record<string, unknown> = { ...raw, theme: normalizeTheme(raw.theme) ?? "dark", daemonTcp: false };

  for (const key of STRING_SETTING_KEYS) {
    const value = normalizeStringSetting(key, raw[key]);
    if (value) out[key] = value;
    else delete out[key];
  }

  const daemonTcp = parseBoolean(raw.daemonTcp);
  out.daemonTcp = daemonTcp ?? false;

  const modelConfig = normalizeModelConfig(raw.modelConfig);
  if (modelConfig) out.modelConfig = modelConfig;
  else delete out.modelConfig;

  if (isRecord(raw.auth)) {
    out.auth = Object.fromEntries(
      Object.entries(raw.auth).filter(([, value]) => typeof value === "string" && value.length > 0),
    );
  } else {
    delete out.auth;
  }

  if (Array.isArray(raw.localProviders)) {
    out.localProviders = raw.localProviders.filter((value): value is Record<string, unknown> => {
      if (!isRecord(value)) return false;
      return normalizeString(value.id) !== undefined
        && normalizeString(value.name) !== undefined
        && normalizeString(value.baseUrl) !== undefined
        && (value.kind === "ollama" || value.kind === "openai-compatible");
    });
  } else {
    delete out.localProviders;
  }

  return out as Settings;
}

function normalizePatch(patch: Partial<Settings>): Record<string, unknown> {
  const raw: Record<string, unknown> = isRecord(patch) ? { ...(patch as Record<string, unknown>) } : {};
  const normalized = normalizeSettings(raw);
  const result: Record<string, unknown> = { ...raw };

  for (const key of STRING_SETTING_KEYS) {
    if (Object.prototype.hasOwnProperty.call(raw, key)) {
      const value = normalizeStringSetting(key, raw[key]);
      if (value) result[key] = value;
      else delete result[key];
    }
  }
  if (Object.prototype.hasOwnProperty.call(raw, "theme")) {
    const theme = normalizeTheme(raw.theme);
    if (theme) result.theme = theme;
    else delete result.theme;
  }
  if (Object.prototype.hasOwnProperty.call(raw, "daemonTcp")) {
    const value = parseBoolean(raw.daemonTcp);
    if (value === undefined) delete result.daemonTcp;
    else result.daemonTcp = value;
  }
  if (Object.prototype.hasOwnProperty.call(raw, "modelConfig")) result.modelConfig = normalized.modelConfig ?? {};
  if (Object.prototype.hasOwnProperty.call(raw, "auth")) result.auth = normalized.auth ?? {};
  if (Object.prototype.hasOwnProperty.call(raw, "localProviders")) result.localProviders = normalized.localProviders ?? [];
  return result;
}

function writeSettingsSnapshot(settings: Record<string, unknown>): void {
  if (!existsSync(PRIME_AGENT_DIR)) mkdirSync(PRIME_AGENT_DIR, { recursive: true });
  writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2) + "\n", "utf8");
}

const AUTH_PATH = join(PRIME_AGENT_DIR, "auth.json");

/**
 * Mirror a provider API key into the daemon's auth file (~/.prime/agent/auth.json).
 *
 * The daemon reads THIS file (AuthStorageData shape: provider -> ApiKeyCredential)
 * for authentication — the bridge settings store alone does not authenticate it.
 * This is the interim mirror the operator authorized so that `login` in the UI
 * actually reaches the daemon (mirrors the daemon's own /login flow).
 *
 * Guardrails:
 *   - Read + merge, never clobber other providers' entries.
 *   - apiKey provided -> upsert { provider: { type: "api_key", key } }.
 *   - apiKey omitted -> remove only the provider's entry, preserve the rest.
 *   - Create ~/.prime/agent/ if missing; single-writer write is acceptable.
 *   - Never called unless the user explicitly logged in/out via the IPC command.
 */
export function writeAuthKey(provider: string, apiKey?: string): void {
  try {
    if (!existsSync(PRIME_AGENT_DIR)) mkdirSync(PRIME_AGENT_DIR, { recursive: true });
    let auth: Record<string, { type: "api_key"; key: string }> = {};
    if (existsSync(AUTH_PATH)) {
      try {
        auth = JSON.parse(readFileSync(AUTH_PATH, "utf8")) as Record<string, { type: "api_key"; key: string }>;
        if (!auth || typeof auth !== "object" || Array.isArray(auth)) auth = {};
      } catch {
        auth = {};
      }
    }
    if (apiKey) {
      auth[provider] = { type: "api_key", key: apiKey };
    } else {
      delete auth[provider];
    }
    writeFileSync(AUTH_PATH, JSON.stringify(auth, null, 2) + "\n", "utf8");
  } catch (err) {
    if (typeof process !== "undefined" && process.stderr) {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`[bridge:auth] failed to write auth.json mirror: ${msg}\n`);
    }
  }
}

import type { AgentMessage as PiAgentMessage } from "@earendil-works/pi-agent-core";
import type {
  AgentInfo,
  AgentMessage,
  AgentSessionState,
  AutonomousConfig,
  ConnectionState,
  ConnectionStatus,
  ContextStats,
  ContextTreeNode,
  CostStats,
  Goal,
  HeartbeatInfo,
  HarnessEntry,
  HarnessRefinement,
  HarnessState,
  KernelCell,
  KernelHealthDiagnostic,
  KernelHealthReason,
  KernelState,
  ModelInfo,
  ProviderInfo,
  QueueState,
  RlmChild,
  RefinementResult,
  ScheduleInfo,
  SessionEvent,
  SessionInfo,
  SessionTree,
  SessionTreeNode,
  Settings,
  TranscriptMessage,
} from "../../src/ipc/contract.js";

// Re-declared locally so we don't need a separate import for these shapes —
// the coding-agent package only exports the main types.
export type AgentConnectionSnapshot = {
  state: AgentConnectionState;
  messages?: PiAgentMessage[];
  streamingMessage?: PiAgentMessage;
  sessionContext?: unknown;
  sessionTree?: { tree: unknown[]; leafId: string | null };
  children?: AgentConnectionRlmChild[];
  parent?: unknown;
  lastEventSequence?: number;
  lastEventCursor?: unknown;
  replay?: unknown;
};

export type AgentConnectionRlmChild = {
  id: string;
  parentId?: string;
  activeSessionId?: string;
  sessionName?: string;
  model?: string;
  label: string;
  status: "queued" | "running" | "done" | "error" | "cancelled";
  durationMs?: number;
  answerPreview?: string;
  repliedSinceTask?: boolean;
  toolUseCount?: number;
  tokenCount?: number;
  recap?: string;
  sessionDir: string;
  activity?: unknown;
  error?: string;
};

export type AgentConnectionSessionHeader = {
  type: "session";
  version?: number;
  id: string;
  timestamp: string;
  cwd: string;
  parentSession?: string;
  rlmDepth?: number;
  git?: { repoUrl?: string; commit?: string; branch?: string };
};

// ---------------------------------------------------------------------------
// Wire type — what the Rust shell speaks on stdout (events) and stdin (acks).
// We re-export the contract types to keep this file in lock-step.
// ---------------------------------------------------------------------------

export type { IpcCommand, IpcEvent, PromptOptions } from "../../src/ipc/contract.js";

// ---------------------------------------------------------------------------
// Status helpers
// ---------------------------------------------------------------------------

export type InternalStatus = "connecting" | "connected" | "disconnected" | "reconnecting";

export function isRecoverableDaemonClose(reason: string): boolean {
  // Session lifecycle closures (completed, killed, replaced, shutdown, update)
  // are terminal. Only transport-loss errors should create a new attachment.
  return reason.startsWith("Lost connection to the Prime Agent daemon.")
    || reason.startsWith("Daemon reconnection failed:");
}

export function toConnectionStatus(
  status: InternalStatus,
  reason?: string,
): ConnectionStatus {
  switch (status) {
    case "connecting":
      return { kind: "connecting" };
    case "connected":
      return { kind: "connected" };
    case "disconnected":
      return { kind: "disconnected", reason };
    case "reconnecting":
      return { kind: "reconnecting" };
  }
}

// ---------------------------------------------------------------------------
// Mappers — AgentConnection → IPC contract
// ---------------------------------------------------------------------------

function mapModel(model: AgentConnectionModel | undefined, thinkingLevel: string | undefined): ConnectionState["model"] {
  if (!model) return undefined;
  return {
    provider: model.provider,
    model: model.id,
    // The active thinking level lives on AgentConnectionState.thinkingLevel,
    // not on the model. Surface it directly so the UI sees the same value
    // the daemon does, instead of guessing from thinkingLevelMap.
    thinking: thinkingLevel,
  };
}

function mapQueue(state: AgentConnectionState): QueueState {
  // isStreaming dominates — busy if any in-flight work.
  if (state.isStreaming || state.isCompacting || state.isBashRunning) {
    return { mode: "busy" };
  }
  const pending = state.sessionActions?.queuedCount ?? 0;
  return { mode: pending > 0 ? "busy" : "idle", pending };
}

function mapGoals(state: AgentConnectionState): Goal[] | undefined {
  const goal = state.goal as unknown as Record<string, unknown> | undefined;
  if (!goal) return undefined;
  const objective = typeof goal.objective === "string" ? (goal.objective as string) : "";
  const statusRaw = typeof goal.status === "string" ? (goal.status as string) : "idle";
  // An idle/empty goal (daemon's emptyGoalState) means no goal is active —
  // don't fabricate one for the UI.
  const activeFlag = typeof goal.active === "boolean" ? (goal.active as boolean) : false;
  if (statusRaw === "idle" || (!objective && !activeFlag)) return undefined;
  const statusMap: Record<string, Goal["status"]> = {
    active: "active",
    paused: "paused",
    complete: "completed",
    budget_limited: "paused",
    error: "cleared",
  };
  const status: Goal["status"] = statusMap[statusRaw] ?? (activeFlag ? "active" : "completed");
  const id = typeof goal.goalId === "string" && goal.goalId
    ? (goal.goalId as string)
    : typeof goal.id === "string" && goal.id
      ? (goal.id as string)
      : "default";
  const progress = typeof goal.progress === "string" ? (goal.progress as string) : undefined;
  return [{ id, objective, status, progress }];
}

// Minimal structural shapes for daemon cron/heartbeat data. These are not
// re-exported from the package, so we type them locally and stay graceful if
// a field is missing.
interface DaemonCronScheduleShape {
  expression?: string;
  kind?: string;
}
interface DaemonCronJobShape {
  id?: string;
  status?: string;
  prompt?: string;
  schedule?: DaemonCronScheduleShape;
  source?: string;
}
interface DaemonHeartbeatShape {
  job?: DaemonCronJobShape;
  sessionName?: string;
}

function cronExpression(job: DaemonCronJobShape | undefined): string {
  return typeof job?.schedule?.expression === "string" ? job.schedule.expression : "";
}

/** Map a daemon cron job (AgentCronJob) to the IPC ScheduleInfo shape. */
export function mapCronJobToSchedule(job: DaemonCronJobShape | undefined): ScheduleInfo | undefined {
  if (!job || typeof job.id !== "string") return undefined;
  return {
    id: job.id,
    cron: cronExpression(job),
    prompt: typeof job.prompt === "string" ? job.prompt : "",
    active: job.status === "active",
  };
}

/** Map the daemon's single active heartbeat (in AgentConnectionState) to IPC HeartbeatInfo[]. */
function mapHeartbeats(state: AgentConnectionState): HeartbeatInfo[] | undefined {
  const hb = state.heartbeat as unknown as DaemonCronJobShape | undefined | null;
  if (!hb || typeof hb.id !== "string") return undefined;
  const interval = cronExpression(hb);
  if (!interval) return undefined;
  return [{ id: hb.id, interval, active: hb.status === "active" }];
}

/**
 * Map the daemon's autonomous config into the IPC AutonomousConfig shape.
 *
 * NOTE: autonomous config is NOT available through AgentConnection — requires
 * daemon API extension. AgentConnectionState carries no autonomous field and the
 * daemon exposes autonomous state only via waitForHeadlessCompletion(), a
 * blocking daemon wait, not a read. So this stays graceful-undefined on the live
 * path; the MockIpcClient supplies a sample for the browser preview only.
 */
function mapAutonomousConfig(state: AgentConnectionState): AutonomousConfig | undefined {
  const raw = (state as unknown as Record<string, unknown>).autonomousConfig;
  if (!raw || typeof raw !== "object") return undefined;
  const cfg = raw as Record<string, unknown>;
  const out: AutonomousConfig = { active: cfg.enabled === true };
  if (typeof cfg.maxTurns === "number") out.maxTurns = cfg.maxTurns as number;
  if (typeof cfg.maxTokens === "number") out.maxTokens = cfg.maxTokens as number;
  if (typeof cfg.timeoutMs === "number") out.maxTime = `${Math.round((cfg.timeoutMs as number) / 60000)}m`;
  const gates = (cfg.gates as Record<string, unknown> | undefined)?.commands;
  if (Array.isArray(gates) && gates.every((g) => typeof g === "string")) {
    out.qualityGates = gates as string[];
  }
  return out;
}

function mapContextStats(state: AgentConnectionState): ContextStats | undefined {
  const cu = state.contextUsage;
  if (!cu) return undefined;
  const ctx: ContextStats = {};
  // ContextUsage shape: { tokens, contextWindow, percent } — guard each field.
  const cuObj = cu as unknown as Record<string, unknown>;
  if (typeof cuObj.tokens === "number") ctx.tokens = cuObj.tokens;
  if (typeof cuObj.contextWindow === "number") ctx.contextWindow = cuObj.contextWindow;
  if (typeof state.messageCount === "number") ctx.messages = state.messageCount;
  return ctx;
}

function mapRlmChildren(snapshot: AgentConnectionSnapshot | undefined): RlmChild[] | undefined {
  const children = snapshot?.children;
  if (!children || children.length === 0) return undefined;
  return children.map((c) => ({
    id: c.id,
    sessionId: c.activeSessionId,
    name: c.sessionName ?? c.label,
    status: (c.status === "queued" || c.status === "running")
      ? "running"
      : c.status === "done"
        ? "done"
        : c.status === "error" || c.status === "cancelled"
          ? "error"
          : "idle",
    parentId: c.parentId,
    summary: c.answerPreview,
  }));
}

export function mapConnectionState(
  state: AgentConnectionState,
  status: InternalStatus,
  reason: string | undefined,
  snapshot: AgentConnectionSnapshot | undefined,
): ConnectionState {
  const cs: ConnectionState = {
    activeSessionId: state.activeSessionId ?? state.sessionId,
    model: mapModel(state.model, state.thinkingLevel as string | undefined),
    status: toConnectionStatus(status, reason),
  };
  const queue = mapQueue(state);
  cs.queue = queue;
  const goals = mapGoals(state);
  if (goals) cs.goals = goals;
  const ctx = mapContextStats(state);
  if (ctx) cs.context = ctx;
  const children = mapRlmChildren(snapshot);
  if (children) cs.rlmChildren = children;
  const heartbeats = mapHeartbeats(state);
  if (heartbeats) cs.heartbeats = heartbeats;
  const auto = mapAutonomousConfig(state);
  if (auto) cs.autonomousConfig = auto;
  return cs;
}

/**
 * Enrich a mapped ConnectionState with daemon fields that require an async
 * read (cron schedules, full heartbeat list, cost/token stats). Each lookup is
 * best-effort — if the daemon lacks a field or the call fails, that field is
 * left untouched (graceful).
 */
export async function enrichConnectionState(
  conn: AgentConnection,
  base: ConnectionState,
): Promise<ConnectionState> {
  const enriched: ConnectionState = { ...base };

  // Schedules: daemon cron-jobs (scheduled prompts).
  try {
    const jobs = (await conn.listCronJobs({ includeInactive: true })) as unknown as DaemonCronJobShape[];
    const schedules: ScheduleInfo[] = [];
    for (const j of jobs) {
      const cron = cronExpression(j);
      if (typeof j.id === "string" && cron) {
        schedules.push({
          id: j.id,
          cron,
          prompt: typeof j.prompt === "string" ? j.prompt : "",
          active: j.status === "active",
        });
      }
    }
    if (schedules.length > 0) enriched.schedules = schedules;
  } catch {
    // daemon lacks cron-jobs read or it failed — leave schedules undefined
  }

  // Heartbeats: full list (richer than the single heartbeat in state).
  try {
    const hbs = (await conn.listHeartbeats()) as unknown as DaemonHeartbeatShape[];
    const heartbeats: HeartbeatInfo[] = [];
    for (const h of hbs) {
      const cron = cronExpression(h.job);
      if (h.job && typeof h.job.id === "string" && cron) {
        heartbeats.push({ id: h.job.id, interval: cron, active: h.job.status === "active" });
      }
    }
    if (heartbeats.length > 0) enriched.heartbeats = heartbeats;
  } catch {
    // leave heartbeats as-is
  }

  // Cost/token stats.
  try {
    const stats = (await conn.getSessionStats()) as unknown as Record<string, unknown>;
    const tokens = (stats.tokens ?? {}) as Record<string, unknown>;
    const costStats: CostStats = {};
    if (typeof stats.cost === "number") {
      // The daemon reports a single cumulative session cost (no separate
      // per-session vs total split), so surface it once as totalCost.
      costStats.totalCost = stats.cost as number;
    }
    if (typeof tokens.input === "number") costStats.inputTokens = tokens.input as number;
    if (typeof tokens.output === "number") costStats.outputTokens = tokens.output as number;
    enriched.costStats = costStats;
  } catch {
    // leave costStats undefined
  }

  return enriched;
}

// ---------------------------------------------------------------------------
// Session event mapper — AgentConnectionSessionEvent → IPC SessionEvent
// ---------------------------------------------------------------------------

function mapSessionEvent(event: AgentConnectionSessionEvent): SessionEvent {
  // The AgentConnectionSessionEvent is a tagged union of {type, ...} shapes.
  // We forward it verbatim with `kind` aliased to `type` so the React client
  // can pattern-match on `kind`. Unknown keys are preserved via the index
  // signature on SessionEvent.
  const e = event as unknown as Record<string, unknown>;
  const kind = typeof e.type === "string" ? e.type : "unknown";
  const out: SessionEvent = { kind };
  for (const [k, v] of Object.entries(e)) {
    if (k === "type") continue;
    (out as Record<string, unknown>)[k] = v;
  }
  return out;
}

// Structural shape of the daemon's RefinementResult (not re-exported from the
// package), kept minimal for mapping to the IPC event.
interface DaemonRefinementResultShape {
  id?: string;
  summary?: string;
  rationale?: string;
  expectedOutcome?: string;
  appliedEdits?: Array<{
    id?: string;
    action?: string;
    kind?: string;
    title?: string;
    applied?: boolean;
    error?: string;
  }>;
  rollbackOf?: string;
  scope?: string;
}

function mapRefinementResult(r: unknown): RefinementResult {
  const raw = (r ?? {}) as DaemonRefinementResultShape;
  const out: RefinementResult = {};
  if (typeof raw.id === "string") out.id = raw.id;
  if (typeof raw.summary === "string") out.summary = raw.summary;
  if (typeof raw.rationale === "string") out.rationale = raw.rationale;
  if (typeof raw.expectedOutcome === "string") out.expectedOutcome = raw.expectedOutcome;
  if (Array.isArray(raw.appliedEdits)) {
    out.appliedEdits = raw.appliedEdits.map((e) => ({
      id: typeof e.id === "string" ? e.id : undefined,
      action: typeof e.action === "string" ? e.action : undefined,
      kind: typeof e.kind === "string" ? e.kind : undefined,
      title: typeof e.title === "string" ? e.title : undefined,
      applied: typeof e.applied === "boolean" ? e.applied : undefined,
      error: typeof e.error === "string" ? e.error : undefined,
    }));
  }
  if (typeof raw.rollbackOf === "string") out.rollbackOf = raw.rollbackOf;
  if (typeof raw.scope === "string") out.scope = raw.scope;
  return out;
}

function refineEventError(inner: AgentConnectionSessionEvent): string {
  const rf = inner as unknown as Record<string, unknown>;
  return typeof rf.error === "string" ? (rf.error as string) : "refinement failed";
}

// ---------------------------------------------------------------------------
// Transcript mapper — PiAgentMessage[] → TranscriptMessage[]
// ---------------------------------------------------------------------------

export function mapAgentMessage(msg: PiAgentMessage, idx: number): TranscriptMessage {
  const m = msg as unknown as Record<string, unknown>;
  const role = (typeof m.role === "string" ? m.role : "system") as TranscriptMessage["role"];
  const id = typeof m.id === "string" ? m.id : `msg-${idx}`;
  const timestamp = typeof m.timestamp === "string"
    ? m.timestamp
    : typeof m.createdAt === "string"
      ? m.createdAt
      : undefined;

  // Content can be string | ContentPart[].
  let content = "";
  const c = m.content;
  if (typeof c === "string") {
    content = c;
  } else if (Array.isArray(c)) {
    content = c
      .map((p) => {
        if (p && typeof p === "object" && "type" in p) {
          const part = p as { type: string; text?: string };
          if (part.type === "text" && typeof part.text === "string") return part.text;
        }
        return "";
      })
      .join("");
  }

  let thinking: string | undefined;
  if (typeof m.thinking === "string") thinking = m.thinking;
  else if (m.thinking && typeof m.thinking === "object" && "text" in (m.thinking as Record<string, unknown>)) {
    thinking = String((m.thinking as Record<string, unknown>).text ?? "");
  }

  const toolCalls = Array.isArray(m.toolCalls)
    ? (m.toolCalls as Array<Record<string, unknown>>).map((tc, i) => ({
        id: typeof tc.id === "string" ? tc.id : `tc-${idx}-${i}`,
        name: typeof tc.name === "string" ? tc.name : typeof tc.toolName === "string" ? tc.toolName : "tool",
        input: typeof tc.input === "string" ? tc.input : tc.input !== undefined ? JSON.stringify(tc.input) : undefined,
        output: typeof tc.output === "string" ? tc.output : tc.output !== undefined ? JSON.stringify(tc.output) : undefined,
        status: (typeof tc.status === "string" ? tc.status : "complete") as "running" | "complete" | "error",
      }))
    : undefined;

  return {
    id,
    role,
    content,
    timestamp,
    thinking,
    toolCalls,
    status: "complete",
  };
}

export async function getTranscript(conn: AgentConnection): Promise<TranscriptMessage[]> {
  const msgs = await conn.getMessages();
  return msgs.map((m, i) => mapAgentMessage(m, i));
}

function textFromContent(value: unknown): string {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return "";
  return value.map((part) => {
    if (!part || typeof part !== "object") return "";
    const p = part as Record<string, unknown>;
    return typeof p.text === "string" ? p.text : "";
  }).join("");
}

const KERNEL_HEALTH_COPY: Record<KernelHealthReason, Omit<KernelHealthDiagnostic, "reason">> = {
  healthy: { message: "The Python workspace is healthy and responding.", nextStep: "No action is needed.", action: "none" },
  starting: { message: "The Python workspace is starting.", nextStep: "Wait a few seconds, then refresh this panel.", action: "wait" },
  not_started: { message: "The Python workspace has not started yet.", nextStep: "Run a code cell to start it.", action: "run_cell" },
  bootstrap_failed: { message: "The Python workspace could not start.", nextStep: "Refresh once. If it stays unavailable, restart the engine and check that Python support is installed.", action: "retry" },
  dead: { message: "The Python workspace stopped unexpectedly.", nextStep: "Restart the engine to create a fresh workspace. In-memory variables will be lost.", action: "restart" },
  namespace_unavailable: { message: "The Python workspace is running, but its live state could not be read.", nextStep: "Wait for the current cell to finish, then refresh this panel.", action: "refresh" },
  browser_preview: { message: "The browser preview has no live Python workspace.", nextStep: "Open the Tauri app to inspect the live kernel.", action: "open_tauri" },
  unavailable: { message: "Kernel health is temporarily unavailable.", nextStep: "Check the engine connection, then refresh this panel.", action: "refresh" },
};

/** Map only allowlisted health fields; daemon errors never cross into the UI. */
export function mapKernelDiagnostic(value: unknown): KernelHealthDiagnostic {
  const raw = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const reason = typeof raw.reason === "string" && Object.prototype.hasOwnProperty.call(KERNEL_HEALTH_COPY, raw.reason)
    ? raw.reason as KernelHealthReason
    : "unavailable";
  return { reason, ...KERNEL_HEALTH_COPY[reason] };
}

/** Build a visible notebook projection from daemon kernel metadata and real IPython tool details. */
export async function getKernelState(conn: AgentConnection): Promise<KernelState> {
  const [daemonState, kernelState, messages] = await Promise.all([
    conn.getState(),
    conn.getKernelState(),
    conn.getMessages(),
  ]);
  const activeTools = Array.isArray(daemonState.activeToolNames) ? daemonState.activeToolNames : [];
  const results = new Map<string, Record<string, unknown>>();
  for (const raw of messages as unknown[]) {
    const msg = (raw ?? {}) as Record<string, unknown>;
    if (msg.role === "toolResult" && msg.toolName === "ipython" && typeof msg.toolCallId === "string") {
      results.set(msg.toolCallId, msg);
    }
  }
  const cells: KernelCell[] = [];
  for (const raw of messages as unknown[]) {
    const msg = (raw ?? {}) as Record<string, unknown>;
    if (msg.role !== "assistant" || !Array.isArray(msg.content)) continue;
    for (const part of msg.content as unknown[]) {
      if (!part || typeof part !== "object") continue;
      const block = part as Record<string, unknown>;
      if (block.type !== "toolCall" || block.name !== "ipython") continue;
      const args = block.arguments && typeof block.arguments === "object"
        ? block.arguments as Record<string, unknown>
        : {};
      const code = typeof args.code === "string" ? args.code : "";
      const id = typeof block.id === "string" ? block.id : `cell-${cells.length + 1}`;
      const result = results.get(id);
      const details = result?.details && typeof result.details === "object"
        ? result.details as Record<string, unknown>
        : undefined;
      const stdout = typeof details?.stdout === "string" ? details.stdout : "";
      const resultText = typeof details?.result === "string" ? details.result : "";
      const output = stdout || resultText || (result ? textFromContent(result.content) : undefined);
      const errorDetails = details?.error && typeof details.error === "object"
        ? details.error as Record<string, unknown>
        : undefined;
      const error = typeof errorDetails?.evalue === "string"
        ? errorDetails.evalue
        : result?.isError === true ? (typeof details?.stderr === "string" ? details.stderr : output) : undefined;
      const executionCount = typeof details?.executionCount === "number" && Number.isInteger(details.executionCount)
        ? details.executionCount
        : undefined;
      cells.push({
        id,
        code,
        status: result ? (result.isError === true ? "error" : "ok") : "running",
        executionCount,
        output,
        error,
        timestamp: typeof msg.timestamp === "string" ? msg.timestamp : undefined,
      });
    }
  }
  const latest = cells[cells.length - 1];
  const running = kernelState.running && kernelState.namespace !== null;
  return {
    status: !activeTools.includes("ipython") ? "unavailable" : latest?.status === "running" ? "running" : running ? "configured" : "unavailable",
    persistent: activeTools.includes("ipython"),
    toolAvailable: activeTools.includes("ipython"),
    sessionId: daemonState.sessionId,
    executionCount: kernelState.executionCount,
    cells,
    variables: kernelState.namespace?.names ?? [],
    imports: kernelState.namespace?.imports ?? [],
    diagnostic: mapKernelDiagnostic(kernelState.diagnostic),
    lastOutput: latest?.output,
    lastError: latest?.error,
  };
}

function readJsonFile(path: string): Record<string, unknown> | undefined {
  try {
    if (!existsSync(path)) return undefined;
    const value = JSON.parse(readFileSync(path, "utf8"));
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
  } catch {
    return undefined;
  }
}

/** Read the daemon-owned continual harness files without claiming mock state. */
export async function getHarnessState(conn: AgentConnection): Promise<HarnessState> {
  const daemonState = await conn.getState();
  const globalPath = join(PRIME_AGENT_DIR, "harness", "harness_state.json");
  const candidatePaths = [globalPath];
  if (typeof daemonState.sessionDir === "string") {
    candidatePaths.push(join(daemonState.sessionDir, "harness", "harness_state.json"));
  }
  const entries: HarnessEntry[] = [];
  const refinements: HarnessRefinement[] = [];
  let source = globalPath;
  for (const path of candidatePaths) {
    const raw = readJsonFile(path);
    if (!raw) continue;
    source = path;
    const records = raw.entries as Record<string, Record<string, unknown>> | undefined;
    if (records) {
      for (const [kind, byId] of Object.entries(records)) {
        if (!byId || typeof byId !== "object") continue;
        for (const [id, value] of Object.entries(byId)) {
          if (!value || typeof value !== "object") continue;
          const entry = value as Record<string, unknown>;
          if (!["prompt", "memory", "skill", "subagent"].includes(kind)) continue;
          entries.push({
            id,
            kind: kind as HarnessEntry["kind"],
            title: typeof entry.title === "string" ? entry.title : id,
            content: typeof entry.content === "string" ? entry.content : "",
            path: typeof entry.path === "string" ? entry.path : undefined,
            scope: entry.scope === "local" ? "local" : "global",
            reference: entry.reference && typeof entry.reference === "object" ? entry.reference as Record<string, unknown> : undefined,
            arguments: entry.arguments && typeof entry.arguments === "object" ? entry.arguments as Record<string, unknown> : undefined,
            version: typeof entry.version === "number" ? entry.version : undefined,
            updatedAt: typeof entry.updated_at === "string" ? entry.updated_at : undefined,
          });
        }
      }
    }
    if (Array.isArray(raw.refinements)) {
      for (const item of raw.refinements) {
        if (!item || typeof item !== "object") continue;
        const r = item as Record<string, unknown>;
        refinements.push({
          id: typeof r.id === "string" ? r.id : `refinement-${refinements.length + 1}`,
          summary: typeof r.summary === "string" ? r.summary : undefined,
          trigger: typeof r.trigger === "string" ? r.trigger : undefined,
          changes: Array.isArray(r.changes) ? r.changes.filter((x): x is string => typeof x === "string") : undefined,
          outcome: typeof r.outcome === "string" ? r.outcome : undefined,
          timestamp: typeof r.created_at === "string" ? r.created_at : undefined,
          rollbackOf: typeof r.rollbackOf === "string" ? r.rollbackOf : undefined,
        });
      }
    }
  }
  const historyPath = join(PRIME_AGENT_DIR, "harness", "refinements.jsonl");
  if (existsSync(historyPath)) {
    for (const line of readFileSync(historyPath, "utf8").split(/\\r?\\n/).filter(Boolean)) {
      const value = readJsonFileFromText(line);
      if (!value || typeof value.id !== "string") continue;
      refinements.push({
        id: value.id,
        summary: typeof value.summary === "string" ? value.summary : undefined,
        changes: Array.isArray(value.appliedEdits) ? value.appliedEdits.map((e) => `${e.applied ? "applied" : "failed"} ${e.action ?? "edit"} ${e.kind ?? ""}`) : undefined,
        timestamp: typeof value.id === "string" ? value.id : undefined,
        rollbackOf: typeof value.rollbackOf === "string" ? value.rollbackOf : undefined,
      });
    }
  }
  return { entries, refinements, source };
}

function readJsonFileFromText(text: string): Record<string, unknown> | undefined {
  try {
    const value = JSON.parse(text);
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Models / providers mapper — getModelCatalog → ModelInfo[] / ProviderInfo[]
// ---------------------------------------------------------------------------

export async function getModels(conn: AgentConnection): Promise<ModelInfo[]> {
  const catalog = await conn.getModelCatalog();
  const out: ModelInfo[] = [];
  for (const m of catalog.models) {
    const mdl = m as unknown as Record<string, unknown>;
    out.push({
      id: m.id,
      name: typeof mdl.name === "string" ? (mdl.name as string) : m.id,
      provider: m.provider,
      contextWindow: m.contextWindow,
      maxContextWindow: m.contextWindow,
      maxOutputTokens: typeof mdl.maxTokens === "number" ? (mdl.maxTokens as number) : undefined,
      maxOutputTokensCeiling: typeof mdl.maxTokens === "number" ? (mdl.maxTokens as number) : undefined,
      supportsThinking: Boolean(m.reasoning),
    });
  }
  return out;
}

export async function getProviders(conn: AgentConnection): Promise<ProviderInfo[]> {
  const catalog = await conn.getModelCatalog();
  const providers = new Map<string, ProviderInfo>();
  for (const m of catalog.models) {
    const mdl = m as unknown as Record<string, unknown>;
    let p = providers.get(m.provider);
    if (!p) {
      p = {
        id: m.provider,
        name: m.provider,
        kind: "api_key",
        connected: catalog.configuredProviders?.includes(m.provider) ?? true,
        models: [],
      };
      providers.set(m.provider, p);
    }
    p.models.push({
      id: m.id,
      name: typeof mdl.name === "string" ? (mdl.name as string) : m.id,
      provider: m.provider,
      contextWindow: m.contextWindow,
      maxContextWindow: m.contextWindow,
      maxOutputTokens: typeof mdl.maxTokens === "number" ? (mdl.maxTokens as number) : undefined,
      maxOutputTokensCeiling: typeof mdl.maxTokens === "number" ? (mdl.maxTokens as number) : undefined,
      supportsThinking: Boolean(m.reasoning),
    });
  }
  return Array.from(providers.values());
}

// ---------------------------------------------------------------------------
// Sessions mapper — listSavedSessions → SessionInfo[]
// ---------------------------------------------------------------------------

interface SavedSessionShape {
  id: string;
  cwd: string;
  name?: string;
  state?: { status?: string };
  created: Date;
  modified: Date;
  firstMessage?: string;
}

function mapSessionInfo(s: SavedSessionShape): SessionInfo {
  return {
    id: s.id,
    title: s.name ?? s.firstMessage?.slice(0, 80),
    cwd: s.cwd,
    createdAt: s.created instanceof Date ? s.created.toISOString() : undefined,
    updatedAt: s.modified instanceof Date ? s.modified.toISOString() : undefined,
    status: s.state?.status === "active"
      ? "active"
      : s.state?.status === "archived"
        ? "idle"
        : "saved",
  };
}

export async function listSessions(conn: AgentConnection): Promise<SessionInfo[]> {
  const sessions = await conn.listSavedSessions("current");
  return (sessions as unknown as SavedSessionShape[]).map(mapSessionInfo);
}

// ---------------------------------------------------------------------------
// Session tree mapper — getSessionTree → SessionTree
// ---------------------------------------------------------------------------

interface DaemonSessionTreeNodeShape {
  entry?: { id?: string; type?: string; timestamp?: string; parentId?: string | null };
  label?: string;
  children?: DaemonSessionTreeNodeShape[];
}

function mapTreeNodes(nodes: DaemonSessionTreeNodeShape[]): SessionTreeNode[] {
  return nodes.map((node) => {
    const out: SessionTreeNode = {
      id: typeof node.entry?.id === "string" ? node.entry.id : "",
      type: typeof node.entry?.type === "string" ? node.entry.type : "message",
    };
    if (typeof node.label === "string" && node.label) out.label = node.label;
    if (typeof node.entry?.timestamp === "string") out.timestamp = node.entry.timestamp;
    // Preserve the daemon's parentId explicitly — roots carry `null`, not an omitted field.
    if (node.entry?.parentId !== undefined) out.parentId = node.entry.parentId ?? null;
    if (Array.isArray(node.children) && node.children.length > 0) {
      out.children = mapTreeNodes(node.children);
    }
    return out;
  });
}

/** Map the daemon session tree into the IPC SessionTree shape. */
export function mapSessionTree(tree: unknown): SessionTree {
  const raw = (tree ?? {}) as { tree?: DaemonSessionTreeNodeShape[]; leafId?: string | null };
  return {
    tree: Array.isArray(raw.tree) ? mapTreeNodes(raw.tree) : [],
    leafId: typeof raw.leafId === "string" ? raw.leafId : raw.leafId == null ? null : undefined,
  };
}

// ---------------------------------------------------------------------------
// Context tree mapper — getContextTree → ContextTreeNode
// ---------------------------------------------------------------------------

interface DaemonContextTreeNodeShape {
  id?: string;
  label?: string;
  status?: string;
  contextUsage?: { tokens?: number };
  children?: DaemonContextTreeNodeShape[];
}

function mapContextTreeNodes(nodes: DaemonContextTreeNodeShape[]): ContextTreeNode[] {
  return nodes.map((n) => {
    const out: ContextTreeNode = {
      id: typeof n.id === "string" ? n.id : "",
      label: typeof n.label === "string" ? n.label : "",
      status: typeof n.status === "string" ? n.status : "active",
      children: Array.isArray(n.children) ? mapContextTreeNodes(n.children) : [],
    };
    const cu = n.contextUsage;
    if (cu && typeof cu.tokens === "number") out.tokens = cu.tokens;
    return out;
  });
}

/** Map the daemon context tree into the IPC ContextTreeNode shape. */
export function mapContextTree(tree: unknown): ContextTreeNode {
  const raw = (tree ?? {}) as DaemonContextTreeNodeShape;
  const out: ContextTreeNode = {
    id: typeof raw.id === "string" ? raw.id : "root",
    label: typeof raw.label === "string" ? raw.label : "root",
    status: typeof raw.status === "string" ? raw.status : "active",
    children: Array.isArray(raw.children) ? mapContextTreeNodes(raw.children) : [],
  };
  // The main-session root's own context usage is the number the frontend most
  // wants — map it just like the children nodes do.
  const cu = raw.contextUsage;
  if (cu && typeof cu.tokens === "number") out.tokens = cu.tokens;
  return out;
}

// ---------------------------------------------------------------------------
// Settings — AgentConnection doesn't model persistent UI settings, so the
// bridge owns their in-memory view and persists them to the shared settings file.
// ---------------------------------------------------------------------------

const DEFAULT_SETTINGS: Settings = {
  theme: "dark",
  daemonTcp: false,
};

export const DEFAULT_MODEL_SELECTION = {
  provider: "ollama-cloud",
  model: "deepseek-v4-flash:0731-cloud",
} as const;

export function resolvePreferredModel(
  settings: Settings,
  current?: { provider?: string; model?: string; id?: string },
): { provider: string; model: string } {
  return {
    provider: normalizeString(settings.defaultProvider) ?? normalizeString(current?.provider) ?? DEFAULT_MODEL_SELECTION.provider,
    model: normalizeString(settings.defaultModel) ?? normalizeString(current?.model ?? current?.id) ?? DEFAULT_MODEL_SELECTION.model,
  };
}

/**
 * Write a per-model context-window / max-tokens override into
 * `~/.prime/agent/models.json`. The daemon re-reads models.json on every
 * `set_model`, so this is the real path by which an in-app override reaches
 * the engine: write the override, then issue `setModel` so the daemon reloads
 * the catalog and applies the new definition.
 *
 * Only the provided fields are touched (existing config is preserved). Falls
 * back to provider-level `modelOverrides` when the model isn't a custom
 * `models[]` entry. Best-effort: on read/parse/write failure it logs and
 * continues without throwing.
 */
export function writeModelOverrideToModelsJson(
  provider: string,
  modelId: string,
  override: { contextWindow?: number; maxTokens?: number },
): void {
  try {
    if (!existsSync(PRIME_AGENT_DIR)) mkdirSync(PRIME_AGENT_DIR, { recursive: true });
    let root: Record<string, unknown> = {};
    if (existsSync(MODELS_JSON_PATH)) {
      try {
        root = JSON.parse(readFileSync(MODELS_JSON_PATH, "utf8")) as Record<string, unknown>;
      } catch {
        root = {};
      }
    }
    const providersObj =
      (root.providers as Record<string, unknown> | undefined) ?? (root.providers = {} as Record<string, unknown>);
    const prov = (providersObj[provider] as Record<string, unknown> | undefined) ?? (providersObj[provider] = {} as Record<string, unknown>);

    // 1) Custom model entry: providers[provider].models[] with matching id.
    const models = Array.isArray(prov.models) ? (prov.models as Array<Record<string, unknown>>) : undefined;
    const custom = models?.find((m) => m.id === modelId);
    if (custom) {
      if (override.contextWindow != null) custom.contextWindow = override.contextWindow;
      if (override.maxTokens != null) custom.maxTokens = override.maxTokens;
    } else {
      // 2) Built-in model: provider-level modelOverrides[modelId].
      const overrides =
        (prov.modelOverrides as Record<string, Record<string, unknown>> | undefined) ??
        (prov.modelOverrides = {} as Record<string, Record<string, unknown>>);
      const entry = overrides[modelId] ?? (overrides[modelId] = {} as Record<string, unknown>);
      if (override.contextWindow != null) entry.contextWindow = override.contextWindow;
      if (override.maxTokens != null) entry.maxTokens = override.maxTokens;
    }
    writeFileSync(MODELS_JSON_PATH, JSON.stringify(root, null, 2) + "\n", "utf8");
  } catch (err) {
    if (typeof process !== "undefined" && process.stderr) {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`[bridge:settings] failed to write models.json override: ${msg}\n`);
    }
  }
}

export class SettingsStore {
  private current: Settings = normalizeSettings({
    ...DEFAULT_SETTINGS,
    ...readSettingsFile(),
  });

  get(): Settings {
    return {
      ...this.current,
      modelConfig: this.current.modelConfig ? { ...this.current.modelConfig } : undefined,
      auth: this.current.auth ? { ...this.current.auth } : undefined,
      localProviders: this.current.localProviders?.map((provider) => ({ ...provider })),
    };
  }

  update(patch: Partial<Settings>): Settings {
    const normalizedPatch = normalizePatch(patch);
    this.current = normalizeSettings({ ...this.current, ...normalizedPatch });
    try {
      writeSettingsSnapshot(this.current as unknown as Record<string, unknown>);
    } catch (err) {
      if (typeof process !== "undefined" && process.stderr) {
        const msg = err instanceof Error ? err.message : String(err);
        process.stderr.write(`[bridge:settings] failed to persist settings: ${msg}\n`);
      }
    }
    return this.get();
  }
}

// ---------------------------------------------------------------------------
// Inbox — AgentConnection supports sending agent messages but doesn't expose
// an inbox read API; we track received messages from the daemon event stream
// in memory so listInbox/markMessageRead can return them.
// ---------------------------------------------------------------------------

export class InboxStore {
  private messages: AgentMessage[] = [];
  private nextId = 1;

  add(fromAgentId: string, message: string, opts?: { fromAgentName?: string; toAgentId?: string; toAgentName?: string; threadId?: string }): AgentMessage {
    const msg: AgentMessage = {
      id: `inbox-${this.nextId++}`,
      fromAgentId,
      fromAgentName: opts?.fromAgentName,
      toAgentId: opts?.toAgentId ?? "self",
      toAgentName: opts?.toAgentName,
      text: message,
      timestamp: new Date().toISOString(),
      read: false,
      threadId: opts?.threadId,
    };
    this.messages.push(msg);
    return msg;
  }

  list(): AgentMessage[] {
    return [...this.messages];
  }

  markRead(messageId: string): boolean {
    const m = this.messages.find((x) => x.id === messageId);
    if (!m) return false;
    m.read = true;
    return true;
  }
}

// ---------------------------------------------------------------------------
// Persistent child-session watches
// ---------------------------------------------------------------------------

interface AgentConnectionSessionWatcher {
  getMessages(): Promise<PiAgentMessage[]>;
  subscribe(listener: (event: AgentConnectionEvent) => void): () => void;
  close(): Promise<void>;
}

interface ChildWatch {
  childId: string;
  sessionId: string;
  watcher: AgentConnectionSessionWatcher;
  unsubscribe: () => void;
  state: AgentSessionState;
  refreshTail: Promise<void>;
}

function toUiChildStatus(status: string): RlmChild["status"] {
  switch (status) {
    case "queued":
    case "running":
      return "running";
    case "done":
      return "done";
    case "error":
    case "cancelled":
      return "error";
    default:
      return "idle";
  }
}

function mapChildSessionState(child: AgentConnectionRlmChild, messages: PiAgentMessage[]): AgentSessionState {
  return {
    id: child.id,
    status: child.status,
    sessionId: child.activeSessionId,
    model: child.model,
    summary: child.recap ?? child.answerPreview,
    activity: child.activity && typeof child.activity === "object"
      ? (child.activity as { kind?: string }).kind
      : undefined,
    tokenCount: child.tokenCount,
    toolUseCount: child.toolUseCount,
    transcript: messages.map((message, index) => mapAgentMessage(message, index)),
  };
}

function transcriptChanged(before: TranscriptMessage[], after: TranscriptMessage[]): boolean {
  if (before.length !== after.length) return true;
  return after.some((message, index) => {
    const previous = before[index];
    return previous?.id !== message.id ||
      previous?.role !== message.role ||
      previous?.content !== message.content ||
      previous?.status !== message.status ||
      JSON.stringify(previous?.toolCalls) !== JSON.stringify(message.toolCalls);
  });
}

// ---------------------------------------------------------------------------
// Connection holder
// ---------------------------------------------------------------------------

export interface ConnectionHolderEvents {
  onEvent: (event: import("../../src/ipc/contract.js").IpcEvent) => void;
}

export interface ConnectionHolderOptions {
  socketPath?: string;
  activeSessionId?: string;
}

export class ConnectionHolder {
  private conn: AgentConnection | undefined;
  private client: DaemonClient | undefined;
  private unsubscribe: (() => void) | undefined;
  private status: InternalStatus = "disconnected";
  private disconnectReason: string | undefined;
  private snapshot: AgentConnectionSnapshot | undefined;
  private latestState: AgentConnectionState | undefined;
  // Async snapshot enrichment can overlap when several daemon events arrive
  // close together. Only the newest refresh may publish, otherwise an older
  // child roster can overwrite a newer one in the frontend.
  private snapshotEventGeneration = 0;
  private readonly settings = new SettingsStore();
  readonly inbox = new InboxStore();
  private readonly events: ConnectionHolderEvents;
  private readonly socketPath: string;
  private readonly preferredSessionId: string | undefined;
  /** One live watcher per child session; entries own their unsubscribe/close lifecycle. */
  private readonly childWatches = new Map<string, ChildWatch>();
  private reconnectPromise: Promise<void> | undefined;
  private stopping = false;

  constructor(events: ConnectionHolderEvents, opts: ConnectionHolderOptions = {}) {
    this.events = events;
    this.socketPath = opts.socketPath ?? defaultDaemonSocketPath();
    this.preferredSessionId = opts.activeSessionId;
  }

  /** Current connection status (internal). */
  getStatus(): InternalStatus {
    return this.status;
  }

  /** Snapshot of the latest daemon state for getState responses. */
  getLatestState(): AgentConnectionState | undefined {
    return this.latestState;
  }

  /** Underlying AgentConnection (undefined until connected). */
  getConnection(): AgentConnection | undefined {
    return this.conn;
  }

  /** Latest snapshot (for rlmChildren, etc.). */
  getSnapshot(): AgentConnectionSnapshot | undefined {
    return this.snapshot;
  }

  /** Settings handle. */
  getSettingsStore(): SettingsStore {
    return this.settings;
  }

  /** Connect to the daemon and attach. Retries until the daemon is ready. */
  async connect(): Promise<void> {
    this.stopping = false;
    this.setStatus("connecting");
    const maxAttempts = 30;
    const baseDelayMs = 500;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        await this.tryConnectOnce();
        return;
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        if (typeof process !== "undefined" && process.stderr) {
          process.stderr.write(`[bridge:connection] connect attempt ${attempt}/${maxAttempts} failed: ${reason}\n`);
        }
        if (attempt >= maxAttempts) {
          this.setStatus("disconnected", reason);
          this.events.onEvent({ type: "connection_status", status: { kind: "disconnected", reason } });
          throw err;
        }
        // Cap the backoff so a wedged transport (e.g. broken named pipe) shows
        // a Disconnected reason in ~30s instead of silently retrying for minutes.
        await new Promise((r) => setTimeout(r, Math.min(baseDelayMs * attempt, 2000)));
      }
    }
  }

  private async tryConnectOnce(allowPreferredSession = true, emitFailure = true): Promise<void> {
    this.client = new DaemonClient(this.socketPath);
    try {
      await this.client.connect();
      // attach() requires an activeSessionId. Discover an existing session
      // via `list`, or create one if there are none.
      const activeSessionId = await this.discoverOrCreateSession(undefined, allowPreferredSession);
      this.conn = await DaemonAgentConnection.attach(this.client, activeSessionId, {
        closeClientOnDispose: true,
        reconnectTimeoutMs: 8_000,
        supportsExtensionUi: true,
        // recoverDaemon enables the DaemonAgentConnection's internal reconnect
        // path: when the socket closes (not via shutdown), the connection
        // re-invokes this callback to re-spawn/re-ping the daemon and then
        // re-attaches. Without it, a transient socket loss emits a terminal
        // "closed" event and the sidecar gives up.
        recoverDaemon: () => this.waitForDaemonReady(),
      });
      if (!this.conn) {
        throw new Error("attach returned no connection");
      }
      this.unsubscribe = this.conn.subscribe((evt) => this.handleEvent(evt));
      // Grab an initial snapshot so subsequent getState() is populated.
      let snapshotOk = true;
      try {
        this.snapshot = await this.conn.getInitialSnapshot();
        this.latestState = this.snapshot.state;
      } catch (err) {
        snapshotOk = false;
        // Snapshot failures are not fatal — the connection itself is up.
        const reason = err instanceof Error ? err.message : String(err);
        if (typeof process !== "undefined" && process.stderr) {
          process.stderr.write(`[bridge:connection] initial snapshot failed: ${reason}\n`);
        }
      }
      this.setStatus("connected");
      this.events.onEvent({
        type: "connection_status",
        status: { kind: "connected" },
      });
      if (snapshotOk && this.latestState) {
        await this.emitEnrichedSnapshot("snapshot");
      }
      // Restore the persisted selection and runtime limits. With no saved
      // selection, the current session model wins; the built-in default is the
      // final fallback only when neither exists.
      await this.applyPreferredModel().catch((err) => {
        if (typeof process !== "undefined" && process.stderr) {
          const msg = err instanceof Error ? err.message : String(err);
          process.stderr.write(`[bridge:connection] applyPreferredModel skipped: ${msg}\n`);
        }
      });
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      this.unsubscribe?.();
      this.unsubscribe = undefined;
      this.conn = undefined;
      this.client?.close();
      this.client = undefined;
      if (emitFailure) {
        this.setStatus("disconnected", reason);
        this.events.onEvent({
          type: "connection_status",
          status: { kind: "disconnected", reason },
        });
      }
      throw err;
    }
  }

  /**
   * Wait for the daemon to be accepting connections before the upstream
   * connection recovery loop creates its replacement transport. The probe is
   * disposable; the recovery loop still owns the actual client connection.
   */
  private async waitForDaemonReady(): Promise<void> {
    const probe = new DaemonClient(this.socketPath);
    try {
      await probe.connect(1_000);
      await probe.waitForHello(3_000);
    } finally {
      probe.close();
    }
  }

  /** Restore the saved model, runtime limits, and thinking level when attached. */
  async applyPreferredModel(): Promise<void> {
    if (!this.conn) return;
    const settings = this.settings.get();
    const current = this.latestState?.model;
    const preferred = resolvePreferredModel(settings, current);
    const key = `${preferred.provider}:${preferred.model}`;
    const runtime = settings.modelConfig?.[key];
    if (runtime && (runtime.contextWindow !== undefined || runtime.maxOutputTokens !== undefined)) {
      writeModelOverrideToModelsJson(preferred.provider, preferred.model, {
        contextWindow: runtime.contextWindow,
        maxTokens: runtime.maxOutputTokens,
      });
    }

    const currentProvider = current && typeof current === "object" ? current.provider : undefined;
    const currentModel = current && typeof current === "object" ? current.id : undefined;
    const selectionMatches = currentProvider === preferred.provider && currentModel === preferred.model;
    if (!selectionMatches || runtime) {
      const updated = await this.conn.setModel(preferred.provider, preferred.model);
      if (updated && typeof updated === "object") {
        this.latestState = {
          ...(this.latestState as object),
          model: updated,
        } as AgentConnectionState;
      }
    }
    if (settings.defaultThinking) {
      await this.conn.setThinkingLevel(settings.defaultThinking as never);
    }
  }

  /**
   * Discover an existing active session via the daemon `list` command, or
   * create a new one via `create`. Returns the activeSessionId to pass to
   * DaemonAgentConnection.attach.
   *
   * If `opts.cwd` or `opts.goal` are provided, the create command forwards
   * them through AgentSessionRuntimeConfig (config.cwd + config.initialGoal).
   * Otherwise a plain create with daemon defaults is issued.
   */
  private async discoverOrCreateSession(
    opts?: { cwd?: string; goal?: string },
    allowPreferredSession = true,
  ): Promise<string> {
    if (!this.client) throw new Error("client not initialized");
    if (allowPreferredSession && this.preferredSessionId) return this.preferredSessionId;
    // Try to attach to an existing session first.
    try {
      const listResp = await this.client.request({ type: "list" }, 10_000);
      const sessions = (listResp as unknown as { data?: { sessions?: Array<{ activeSessionId?: string; id: string }> } }).data?.sessions;
      if (Array.isArray(sessions) && sessions.length > 0) {
        const first = sessions[0];
        const id = first.activeSessionId ?? first.id;
        if (typeof id === "string" && id.length > 0) return id;
      }
    } catch (err) {
      if (typeof process !== "undefined" && process.stderr) {
        const msg = err instanceof Error ? err.message : String(err);
        process.stderr.write(`[bridge:connection] list failed (will try create): ${msg}\n`);
      }
    }
    // No existing sessions — create a new one, threading cwd/goal through the
    // AgentSessionRuntimeConfig the daemon accepts on its create command.
    const config: Record<string, unknown> = {};
    if (opts?.cwd) config.cwd = opts.cwd;
    if (opts?.goal) config.initialGoal = { objective: opts.goal };
    const createResp = await this.client.request(
      { type: "create", ...(Object.keys(config).length > 0 ? { config } : {}) },
      30_000,
    );
    const created = (createResp as unknown as { data?: { activeSessionId?: string; id: string } }).data;
    if (!created) throw new Error("daemon create returned no data");
    const id = created.activeSessionId ?? created.id;
    if (typeof id !== "string" || id.length === 0) {
      throw new Error("daemon create returned no activeSessionId");
    }
    return id;
  }

  /**
   * Resolve a session identifier (path or session id or name) to a transcript
   * entry id that AgentConnection.fork() accepts. Returns undefined when the
   * session cannot be found or has no entries yet.
   */
  async resolveSessionToEntryId(conn: AgentConnection, pathOrId: string): Promise<string | undefined> {
    const treeResp = await conn.getSessionTree();
    const tree = treeResp?.tree;
    const leafId = treeResp?.leafId;
    if (!Array.isArray(tree) || tree.length === 0) return undefined;
    if (pathOrId) {
      const collectEntries = (nodes: unknown[]): string[] => {
        const out: string[] = [];
        for (const node of nodes) {
          if (!node || typeof node !== "object") continue;
          const n = node as { entry?: { id?: string }; children?: unknown[] };
          if (n.entry && typeof n.entry.id === "string") out.push(n.entry.id);
          if (Array.isArray(n.children)) out.push(...collectEntries(n.children));
        }
        return out;
      };
      const ids = collectEntries(tree);
      if (typeof leafId === "string" && leafId.length > 0 && ids.includes(leafId)) return leafId;
      if (ids.length > 0) return ids[ids.length - 1];
    }
    return undefined;
  }

  /**
   * Resolve a fork request to a VALID user-message entry id that the daemon's
   * `fork` command accepts.
   *
   * The daemon only forks from user-message transcript entries (assistant
   * replies and system entries are rejected with "Invalid entry ID for
   * forking"). The frontend passes a transcript message id (`msg-N`, a
   * synthetic index the bridge assigns when the daemon message carries no
   * id), so we map it to the Nth user message's fork point via
   * `getUserMessagesForForking()`. A direct entry id is verified against the
   * forkable set; a session id/path resolves to the most recent user message.
   *
   * Returns undefined when no forkable point can be resolved.
   */
  async resolveForkEntryId(conn: AgentConnection, pathOrId: string): Promise<string | undefined> {
    let forkable: Array<{ entryId?: string; text?: string }> = [];
    try {
      const msgs = (await conn.getUserMessagesForForking()) as unknown as Array<{ entryId?: string; text?: string }>;
      if (Array.isArray(msgs)) forkable = msgs;
    } catch {
      // daemon lacks the read — fall through to tree-based resolution below
    }
    const valid = forkable.filter((f) => typeof f.entryId === "string" && f.entryId.length > 0);

    // 1) Transcript message id like "msg-3" → the Nth user message's fork point.
    const msgMatch = /^msg-(\d+)$/.exec(pathOrId);
    if (msgMatch) {
      const idx = Number(msgMatch[1]);
      if (valid.length > 0) {
        let userCount = 0;
        try {
          const all = await conn.getMessages();
          for (let i = 0; i <= idx && i < all.length; i++) {
            const role = (all[i] as unknown as { role?: string })?.role;
            if (role === "user") userCount++;
          }
        } catch {
          // fall back to treating the id as a 1-based user index
          userCount = idx + 1;
        }
        const target = valid[userCount - 1];
        if (target && typeof target.entryId === "string") return target.entryId;
      }
      return undefined;
    }

    // 2) Direct entry id — only accept it if it is actually forkable.
    if (valid.some((f) => f.entryId === pathOrId)) return pathOrId;

    // 3) Session id / path / anything else → most recent user message fork point.
    if (valid.length > 0) {
      const last = valid[valid.length - 1];
      if (last && typeof last.entryId === "string") return last.entryId;
    }

    // 4) Fallback: tree-based leaf resolution (best-effort; the daemon may
    //    still reject a non-user leaf, in which case the caller surfaces the
    //    daemon's clear error).
    return this.resolveSessionToEntryId(conn, pathOrId);
  }

  /** Attach one persistent watcher to a child session and publish its initial state. */
  async attachChildAgent(child: AgentConnectionRlmChild): Promise<{ childId: string; sessionId: string; attached: true }> {
    const sessionId = child.activeSessionId;
    if (!sessionId) throw new Error(`agent not found or not attachable: ${child.id}`);

    const existing = this.childWatches.get(sessionId);
    if (existing) {
      if (existing.childId === child.id) return { childId: child.id, sessionId, attached: true };
      await this.closeChildWatch(sessionId, "replaced");
    }

    const conn = this.conn;
    if (!conn) throw new Error("daemon connection unavailable");
    const watcher = await conn.watchSession(sessionId);
    if (!watcher) throw new Error(`failed to attach to agent ${child.id}`);

    const watch: ChildWatch = {
      childId: child.id,
      sessionId,
      watcher,
      unsubscribe: () => {},
      state: mapChildSessionState(child, []),
      refreshTail: Promise.resolve(),
    };
    watch.unsubscribe = watcher.subscribe((event) => { void this.handleChildWatchEvent(watch, event); });
    this.childWatches.set(sessionId, watch);

    try {
      watch.state = mapChildSessionState(child, await watcher.getMessages());
      if (this.childWatches.get(sessionId) !== watch) throw new Error("child watcher was closed during attach");
      this.events.onEvent({ type: "agent_watch", event: { kind: "attached", childId: child.id, sessionId, state: watch.state } });
      return { childId: child.id, sessionId, attached: true };
    } catch (error) {
      await this.closeChildWatch(sessionId, "attach failed");
      throw error;
    }
  }

  /** Stop monitoring a child session and release its daemon watcher. */
  async detachChildAgent(childId: string): Promise<void> {
    const watch = [...this.childWatches.values()].find((candidate) => candidate.childId === childId);
    if (watch) await this.closeChildWatch(watch.sessionId, "detached");
  }

  getAttachedChildState(childId: string): AgentSessionState | undefined {
    return [...this.childWatches.values()].find((watch) => watch.childId === childId)?.state;
  }

  private publishChildState(watch: ChildWatch, next: AgentSessionState): void {
    if (this.childWatches.get(watch.sessionId) !== watch) return;
    const statusChanged = next.status !== watch.state.status ||
      next.summary !== watch.state.summary ||
      next.activity !== watch.state.activity ||
      next.tokenCount !== watch.state.tokenCount ||
      next.toolUseCount !== watch.state.toolUseCount;
    const messagesChanged = transcriptChanged(watch.state.transcript, next.transcript);
    if (!statusChanged && !messagesChanged) return;

    watch.state = next;
    if (statusChanged) {
      this.events.onEvent({
        type: "agent_watch",
        event: {
          kind: "status",
          childId: watch.childId,
          status: toUiChildStatus(next.status),
          state: next,
        },
      });
    }
    if (messagesChanged) {
      const message = next.transcript[next.transcript.length - 1];
      if (message) {
        this.events.onEvent({ type: "agent_watch", event: { kind: "message", childId: watch.childId, state: next, message } });
      }
      this.events.onEvent({ type: "agent_watch", event: { kind: "transcript", childId: watch.childId, state: next, message } });
    }
  }

  private async handleChildWatchEvent(watch: ChildWatch, event: AgentConnectionEvent): Promise<void> {
    if (this.childWatches.get(watch.sessionId) !== watch) return;
    if (event.type === "closed") {
      await this.closeChildWatch(watch.sessionId, event.error ?? "child session closed");
      return;
    }
    watch.refreshTail = watch.refreshTail.then(async () => {
      if (this.childWatches.get(watch.sessionId) !== watch) return;
      const messages = await watch.watcher.getMessages();
      if (this.childWatches.get(watch.sessionId) !== watch) return;
      const child = this.snapshot?.children?.find((candidate) => candidate.id === watch.childId);
      const fallback: AgentConnectionRlmChild = {
        id: watch.childId,
        activeSessionId: watch.sessionId,
        label: watch.childId,
        status: watch.state.status as AgentConnectionRlmChild["status"],
        sessionDir: "",
      };
      this.publishChildState(watch, mapChildSessionState(child ?? fallback, messages));
    }).catch((error) => {
      if (this.childWatches.get(watch.sessionId) !== watch) return;
      this.publishChildState(watch, {
        ...watch.state,
        status: "error",
        summary: error instanceof Error ? error.message : String(error),
      });
    });
    await watch.refreshTail;
  }

  private async closeChildWatch(sessionId: string, reason: string): Promise<void> {
    const watch = this.childWatches.get(sessionId);
    if (!watch) return;
    this.childWatches.delete(sessionId);
    watch.unsubscribe();
    await watch.watcher.close().catch(() => {});
    this.events.onEvent({ type: "agent_watch", event: { kind: "detached", childId: watch.childId, sessionId, reason } });
  }

  private async closeAllChildWatches(reason: string): Promise<void> {
    await Promise.all([...this.childWatches.keys()].map((sessionId) => this.closeChildWatch(sessionId, reason)));
  }

  /**
   * Issue a daemon `create` command with the supplied runtime config
   * (cwd + initialGoal), then re-attach the bridge to the new session.
   * Used by the rpc.ts newSession dispatcher when cwd/goal are present,
   * because AgentConnection.newSession has no way to thread those through.
   *
   * Failure semantics: if the daemon rejects the create or the subsequent
   * re-attach fails, we surface a disconnected status to the UI and throw.
   * The original connection is gone (we disposed it before re-attaching);
   * a follow-up newSession/list call will need to re-trigger `connect()` to
   * re-establish a working session.
   */
  async createSessionWithConfig(opts: { cwd?: string; goal?: string }): Promise<string> {
    if (!this.client) throw new Error("client not initialized");
    const config: Record<string, unknown> = {};
    if (opts.cwd) config.cwd = opts.cwd;
    if (opts.goal) config.initialGoal = { objective: opts.goal };
    const createResp = await this.client.request(
      { type: "create", ...(Object.keys(config).length > 0 ? { config } : {}) },
      30_000,
    );
    const created = (createResp as unknown as { data?: { activeSessionId?: string; id: string } }).data;
    if (!created) throw new Error("daemon create returned no data");
    const newId = created.activeSessionId ?? created.id;
    if (typeof newId !== "string" || newId.length === 0) {
      throw new Error("daemon create returned no activeSessionId");
    }
    // Tear down the current attach BEFORE issuing the re-attach: the daemon
    // may refuse two attaches from the same client at the same time.
    await this.disposeConnectionOnly();
    // The AgentConnection was created with closeClientOnDispose: true, so
    // disposing it closed the DaemonClient. Reconnect it before re-attaching,
    // otherwise the attach below fails with "daemon is not connected".
    if (this.client && !this.client.isConnected) {
      await this.client.connect();
    }
    try {
      this.conn = await DaemonAgentConnection.attach(this.client, newId, {
        closeClientOnDispose: true,
        reconnectTimeoutMs: 8_000,
        supportsExtensionUi: true,
        recoverDaemon: () => this.waitForDaemonReady(),
      });
    } catch (err) {
      // Re-attach failed — the bridge is now disconnected. Surface it so the
      // UI can prompt for a reconnect instead of silently losing the
      // session.
      const reason = err instanceof Error ? err.message : String(err);
      this.setStatus("disconnected", reason);
      this.events.onEvent({
        type: "connection_status",
        status: { kind: "disconnected", reason },
      });
      throw err;
    }
    if (!this.conn) throw new Error("re-attach returned no connection");
    this.unsubscribe = this.conn.subscribe((evt) => this.handleEvent(evt));
    let snapshotOk = true;
    try {
      this.snapshot = await this.conn.getInitialSnapshot();
      this.latestState = this.snapshot.state;
    } catch (err) {
      snapshotOk = false;
      if (typeof process !== "undefined" && process.stderr) {
        const msg = err instanceof Error ? err.message : String(err);
        process.stderr.write(`[bridge:connection] re-attach snapshot failed: ${msg}\n`);
      }
    }
    if (snapshotOk && this.latestState) {
      await this.emitEnrichedSnapshot("snapshot");
    }
    await this.applyPreferredModel().catch(() => undefined);
    return newId;
  }

  /** Tear down the AgentConnection without disposing the DaemonClient. */
  private async disposeConnectionOnly(): Promise<void> {
    await this.closeAllChildWatches("reconnect");
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    if (this.conn) {
      try {
        await this.conn.dispose();
      } catch {
        // best-effort
      }
      this.conn = undefined;
    }
  }

  /** Rebuild the client/session after the upstream reconnect exhausted its stale attach. */
  private async reconnectFromClosed(reason: string): Promise<void> {
    if (this.stopping || this.reconnectPromise) return;
    const recovery = (async () => {
      this.setStatus("reconnecting", reason);
      this.events.onEvent({ type: "connection_status", status: { kind: "reconnecting" } });
      await this.disposeConnectionOnly();

      const deadline = Date.now() + 30_000;
      let attempt = 0;
      let lastError = reason;
      while (!this.stopping && Date.now() < deadline) {
        try {
          await this.tryConnectOnce(false, false);
          return;
        } catch (error) {
          lastError = error instanceof Error ? error.message : String(error);
          const remaining = deadline - Date.now();
          if (remaining <= 0) break;
          await new Promise((resolve) => setTimeout(resolve, Math.min(remaining, 500 * 2 ** Math.min(attempt++, 3))));
        }
      }
      if (!this.stopping) {
        this.setStatus("disconnected", lastError);
        this.events.onEvent({ type: "connection_status", status: { kind: "disconnected", reason: lastError } });
      }
    })();
    this.reconnectPromise = recovery;
    try {
      await recovery;
    } finally {
      if (this.reconnectPromise === recovery) this.reconnectPromise = undefined;
    }
  }

  /** Disconnect from the daemon and release resources. */
  async disconnect(): Promise<void> {
    this.stopping = true;
    this.client?.close();
    await this.reconnectPromise?.catch(() => {});
    await this.closeAllChildWatches("connection closed");
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    if (this.conn) {
      try {
        await this.conn.dispose();
      } catch {
        // best-effort
      }
      this.conn = undefined;
    }
    if (this.client) {
      this.client.close();
      this.client = undefined;
    }
  }

  private setStatus(status: InternalStatus, reason?: string): void {
    this.status = status;
    this.disconnectReason = reason;
  }

  private handleEvent(evt: AgentConnectionEvent): void {
    switch (evt.type) {
      case "session_event": {
        const inner = evt.event as unknown as { type?: string };
        const innerType = typeof inner.type === "string" ? inner.type : "";
        // RLM child updates are delivered as session events. The upstream
        // AgentConnection deliberately updates its attach snapshot from these
        // events, but this adapter used to forward the event only and kept the
        // original empty child roster. That made getRlmChildren(), attachAgent,
        // and sendAgentMessage permanently blind to children admitted after
        // connect.
        if (innerType === "rlm_child_update") {
          const child = (evt.event as unknown as { child?: AgentConnectionRlmChild }).child;
          if (child && typeof child.id === "string") {
            const existing = this.snapshot?.children ?? [];
            const children = [...existing.filter((candidate) => candidate.id !== child.id), child];
            if (this.snapshot) {
              this.snapshot = { ...this.snapshot, children };
            }
            // Push the updated roster to Tauri clients immediately; the RPC
            // methods also read the same cache, so both polling and events agree.
            this.refreshSnapshotEvent();
            const watch = [...this.childWatches.values()].find((candidate) => candidate.childId === child.id);
            if (watch) {
              if (child.activeSessionId && child.activeSessionId !== watch.sessionId) {
                void this.closeChildWatch(watch.sessionId, "child session replaced");
              } else {
                this.publishChildState(watch, {
                  ...watch.state,
                  status: child.status,
                  summary: child.recap ?? child.answerPreview,
                  activity: child.activity && typeof child.activity === "object"
                    ? (child.activity as { kind?: string }).kind
                    : undefined,
                  tokenCount: child.tokenCount,
                  toolUseCount: child.toolUseCount,
                });
                if (child.status === "done" || child.status === "error" || child.status === "cancelled") {
                  void this.closeChildWatch(watch.sessionId, "child completed");
                }
              }
            }
          }
        }
        // State-shape updates: refresh the snapshot so goals / session name /
        // heartbeats stay current in the live ConnectionState.
        if (innerType === "goal_update" || innerType === "session_info_changed") {
          this.refreshSnapshotEvent();
        }
        // Refinement results surface as a dedicated IPC event (plus the raw
        // session_event for any client that pattern-matches on kind).
        if (innerType === "refine_complete" || innerType === "refine_failed") {
          this.events.onEvent({
            type: "refinement_result",
            result: innerType === "refine_complete"
              ? mapRefinementResult((evt.event as unknown as Record<string, unknown>).result)
              : { error: refineEventError(evt.event) },
          });
        }
        this.events.onEvent({ type: "session_event", event: mapSessionEvent(evt.event) });
        return;
      }
      case "session_replaced": {
        // The session was swapped out under us — child watchers belong to the
        // previous parent connection and must not leak across sessions.
        void this.closeAllChildWatches("parent session replaced");
        this.latestState = evt.state;
        void this.emitEnrichedSnapshot("snapshot");
        return;
      }
      case "session_resynced": {
        // Full re-sync — adopt the snapshot's state as authoritative. A
        // reconnect requires an explicit re-attach so stale child watchers do
        // not survive a transport generation change.
        void this.closeAllChildWatches("parent connection resynced");
        this.snapshot = evt.snapshot;
        this.latestState = evt.snapshot.state;
        void this.emitEnrichedSnapshot("resynced");
        return;
      }
      case "session_status":
        // A one-line recap — not mapped into ConnectionState; forward as a
        // session_event so the UI can consume it if it cares.
        this.events.onEvent({
          type: "session_event",
          event: { kind: "session_status", recap: evt.recap },
        });
        return;
      case "connection_status":
        if (evt.status === "reconnecting") {
          void this.closeAllChildWatches("reconnecting");
          this.setStatus("reconnecting", evt.error);
          this.events.onEvent({ type: "connection_status", status: { kind: "reconnecting" } });
        } else if (evt.status === "connected") {
          this.setStatus("connected");
          this.events.onEvent({ type: "connection_status", status: { kind: "connected" } });
        }
        return;
      case "extension_ui_request":
        this.events.onEvent({ type: "extension_ui_request", request: evt.request });
        return;
      case "extension_error":
        this.events.onEvent({
          type: "session_event",
          event: { kind: "extension_error", extensionPath: evt.extensionPath, event: evt.event, error: evt.error },
        });
        return;
      case "heartbeats_changed":
        this.refreshSnapshotEvent();
        this.events.onEvent({
          type: "session_event",
          event: { kind: "heartbeats_changed" },
        });
        return;
      case "side_question_event":
        this.events.onEvent({
          type: "session_event",
          event: { kind: "side_question_event", id: evt.event.id, status: evt.event.status },
        });
        return;
      case "closed": {
        const reason = evt.error ?? "daemon connection closed";
        if (isRecoverableDaemonClose(reason)) {
          void this.reconnectFromClosed(reason);
        } else {
          void this.closeAllChildWatches("parent connection closed");
          this.setStatus("disconnected", reason);
          this.events.onEvent({ type: "connection_status", status: { kind: "disconnected", reason } });
        }
        return;
      }
    }
  }

  /** Re-emit a snapshot built from the latest known daemon state (no-op if none). */
  private refreshSnapshotEvent(): void {
    void this.emitEnrichedSnapshot("snapshot");
  }

  /**
   * Build the IPC state from the latest daemon state + snapshot, enrich it with
   * async-only daemon fields (schedules, full heartbeat list, cost stats), and
   * emit it as a snapshot/resynced event. This keeps the event-driven live state
   * in agreement with getState() — a refresh no longer wipes the enriched fields.
   *
   * Enrichment performs several daemon reads and can overlap with another
   * refresh. Generation-checking prevents a slow older read from publishing a
   * stale child roster after a newer event has already been processed.
   */
  private async emitEnrichedSnapshot(kind: "snapshot" | "resynced", generation = ++this.snapshotEventGeneration): Promise<void> {
    const conn = this.conn;
    if (!conn || !this.latestState) return;
    const base = mapConnectionState(this.latestState, this.status, this.disconnectReason, this.snapshot);
    const enriched = await enrichConnectionState(conn, base);
    if (generation !== this.snapshotEventGeneration || conn !== this.conn) return;
    this.events.onEvent({ type: kind, state: enriched });
  }
}

// ---------------------------------------------------------------------------
// Header accessor — used by getTranscript and similar.
// ---------------------------------------------------------------------------

export async function getSessionHeader(conn: AgentConnection): Promise<AgentConnectionSessionHeader | undefined> {
  return conn.getSessionHeader();
}
