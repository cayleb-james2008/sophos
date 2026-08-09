// IPC contract — the shared type surface between the React frontend, the Rust
// Tauri bridge, and the Node bridge sidecar (which owns the daemon connection).
// This is the single source of truth for the JSON-RPC contract. Do not drift.

// ---------------------------------------------------------------------------
// Commands (frontend -> sidecar, via Rust)
// ---------------------------------------------------------------------------

export type IpcCommand =
  | { method: "prompt"; params: { text: string; options?: PromptOptions } }
  | { method: "abort"; params: {} }
  | { method: "steer"; params: { text: string } }
  | { method: "setModel"; params: { provider: string; model: string; thinking?: string; serviceTier?: string; transport?: string; contextWindow?: number; maxOutputTokens?: number } }
  | { method: "newSession"; params: { cwd?: string; goal?: string } }
  | { method: "switchSession"; params: { id: string } }
  | { method: "resumeSession"; params: { pathOrId: string } }
  | { method: "forkSession"; params: { pathOrId: string } }
  | { method: "listSessions"; params: {} }
  | { method: "listAgents"; params: {} }
  | { method: "attachAgent"; params: { id: string } }
  | { method: "getState"; params: {} }
  | { method: "getTranscript"; params: {} }
  | { method: "getModels"; params: {} }
  | { method: "getProviders"; params: {} }
  | { method: "login"; params: { provider: string; apiKey?: string } }
  | { method: "logout"; params: { provider: string } }
  | { method: "getSettings"; params: {} }
  | { method: "setSettings"; params: { settings: Record<string, unknown> } }
  | { method: "runCommand"; params: { command: string; args?: string[] } }
  | { method: "getContextStats"; params: {} }
  | { method: "getRlmChildren"; params: {} }
  | { method: "sendAgentMessage"; params: { agentId: string; message: string } }
  | { method: "listInbox"; params: {} }
  | { method: "markMessageRead"; params: { messageId: string } }
  | { method: "compact"; params: { prompt?: string } }
  | { method: "retry"; params: {} }
  | { method: "refine"; params: {} }
  | { method: "exportSession"; params: { format?: string } }
  | { method: "shareSession"; params: {} }
  | { method: "getSessionTree"; params: {} }
  | { method: "cloneSession"; params: {} }
  | { method: "nameSession"; params: { name: string } }
  | { method: "sideQuestion"; params: { text: string } }
  | { method: "addSchedule"; params: { cron: string; prompt: string } }
  | { method: "removeSchedule"; params: { id: string } }
  | { method: "setHeartbeat"; params: { schedule: string; prompt?: string } }
  | { method: "removeHeartbeat"; params: {} }
  | { method: "navigateTree"; params: { entryId: string } }
  | { method: "startSideQuestion"; params: { text: string } }
  | { method: "exportToHtml"; params: { outputPath?: string } }
  | { method: "exportToJsonl"; params: { outputPath?: string } }
  | { method: "setSessionName"; params: { name: string } }
  | { method: "getContextTree"; params: {} };

export interface PromptOptions {
  thinking?: string;
  serviceTier?: string;
  transport?: string;
  goal?: string;
}

// ---------------------------------------------------------------------------
// Events (sidecar -> frontend, via Rust)
// ---------------------------------------------------------------------------

export type IpcEvent =
  | { type: "session_event"; event: SessionEvent }
  | { type: "snapshot"; state: ConnectionState }
  | { type: "resynced"; state: ConnectionState }
  | { type: "connection_status"; status: ConnectionStatus }
  | { type: "extension_ui_request"; request: unknown }
  | { type: "agent_message"; message: AgentMessage }
  | { type: "agent_list"; agents: AgentInfo[] }
  | { type: "agent_status"; agent: AgentInfo }
  | { type: "refinement_result"; result: RefinementResult };

export type ConnectionStatus =
  | { kind: "connecting" }
  | { kind: "connected" }
  | { kind: "disconnected"; reason?: string }
  | { kind: "reconnecting" };

// ---------------------------------------------------------------------------
// Data shapes
// ---------------------------------------------------------------------------

export interface ConnectionState {
  activeSessionId?: string;
  model?: { provider: string; model: string; thinking?: string };
  status: ConnectionStatus;
  queue?: QueueState;
  goals?: Goal[];
  context?: ContextStats;
  rlmChildren?: RlmChild[];
  /** Cron-driven scheduled prompts (from the daemon's cron-jobs). */
  schedules?: ScheduleInfo[];
  /** Heartbeat jobs that nudge the session on an interval. */
  heartbeats?: HeartbeatInfo[];
  /** Autonomous/headless run configuration (active limits + gates). */
  autonomousConfig?: AutonomousConfig;
  /** Session cost / token accounting. */
  costStats?: CostStats;
}

/** A single scheduled (cron) prompt. */
export interface ScheduleInfo {
  id: string;
  cron: string;
  prompt: string;
  active: boolean;
}

/** A single heartbeat job. `interval` is the cron expression or human interval. */
export interface HeartbeatInfo {
  id: string;
  interval: string;
  active: boolean;
}

/** Autonomous/headless mode configuration surfaced to the frontend. */
export interface AutonomousConfig {
  active: boolean;
  maxTurns?: number;
  maxTokens?: number;
  maxTime?: string;
  qualityGates?: string[];
}

/** Session cost / token accounting from the daemon. */
export interface CostStats {
  totalCost?: number;
  inputTokens?: number;
  outputTokens?: number;
  sessionCost?: number;
}

/** Node in a session transcript tree. */
export interface SessionTreeNode {
  id: string;
  type: string;
  label?: string;
  timestamp?: string;
  parentId?: string | null;
  children?: SessionTreeNode[];
}

/** Result of getSessionTree(). */
export interface SessionTree {
  tree: SessionTreeNode[];
  leafId?: string | null;
}

/** Result of navigateTree(). */
export interface NavigateTreeResult {
  editorText?: string;
  cancelled: boolean;
  aborted?: boolean;
}

/** A node in the daemon's context tree (getContextTree). */
export interface ContextTreeNode {
  id: string;
  label: string;
  status: string;
  /** Current context usage in tokens for this node, when reported. */
  tokens?: number;
  children: ContextTreeNode[];
}

/** Refinement (continual-harness) result pushed as an event. */
export interface RefinementResult {
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
  error?: string;
}

export interface QueueState {
  mode: "idle" | "busy" | "paused";
  pending?: number;
}

export interface Goal {
  id: string;
  objective: string;
  status: "active" | "paused" | "completed" | "cleared";
  progress?: string;
}

export interface ContextStats {
  tokens?: number;
  contextWindow?: number;
  messages?: number;
  compaction?: { lastCompactedAt?: string; reason?: string };
}

export interface RlmChild {
  id: string;
  name?: string;
  status: "running" | "idle" | "done" | "error";
  parentId?: string;
  summary?: string;
}

export interface SessionEvent {
  kind: string;
  [key: string]: unknown;
}

export interface TranscriptMessage {
  id: string;
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  timestamp?: string;
  thinking?: string;
  toolCalls?: ToolCall[];
  status?: "streaming" | "complete" | "error";
}

export interface ToolCall {
  id: string;
  name: string;
  input?: string;
  output?: string;
  status?: "running" | "complete" | "error";
}

export interface ModelInfo {
  id: string;
  name?: string;
  provider: string;
  /** Effective (active) context window in tokens — reflects the persisted override or the provider max by default. */
  contextWindow?: number;
  /** Effective max output tokens — reflects the persisted override or the provider max by default. */
  maxOutputTokens?: number;
  /** Provider ceiling for the context window. Shown as the adjuster's max. */
  maxContextWindow?: number;
  /** Provider ceiling for max output tokens. Shown as the adjuster's max. */
  maxOutputTokensCeiling?: number;
  supportsThinking?: boolean;
}

/**
 * Per-model runtime override — the context window and max output tokens the
 * engine should use for a given model. Persisted in settings and applied to
 * the engine when the model is selected. Defaults to the provider maximum.
 */
export interface ModelRuntimeConfig {
  contextWindow?: number;
  maxOutputTokens?: number;
}

export interface ProviderInfo {
  id: string;
  name: string;
  kind: "subscription" | "api_key";
  connected: boolean;
  models: ModelInfo[];
}

export interface SessionInfo {
  id: string;
  title?: string;
  cwd?: string;
  createdAt?: string;
  updatedAt?: string;
  status?: "active" | "idle" | "saved";
}

export interface AgentInfo {
  id: string;
  name?: string;
  status: "running" | "idle" | "saved";
  sessionId?: string;
}

export interface AgentMessage {
  id: string;
  fromAgentId: string;
  fromAgentName?: string;
  toAgentId: string;
  toAgentName?: string;
  text: string;
  timestamp?: string;
  read?: boolean;
  threadId?: string;
}

export interface Settings {
  shellPath?: string;
  sessionDir?: string;
  /** Default working directory for new sessions — persisted when the user picks "save as default". */
  defaultCwd?: string;
  defaultProvider?: string;
  defaultModel?: string;
  theme?: "dark" | "light" | "system";
  daemonCliPath?: string;
  /** TCP-loopback daemon transport fallback (persisted to ~/.prime/agent/settings.json). */
  daemonTcp?: boolean;
  /**
   * Per-model runtime overrides (context window + max output tokens), keyed by
   * `${provider}:${model}`. Defaults each model to its provider maximum. Sent to
   * the engine on selection and persisted here so it survives reconnects.
   */
  modelConfig?: Record<string, ModelRuntimeConfig>;
  /** API keys per provider, stored/removed by login/logout (persisted to settings). */
  auth?: Record<string, string>;
}
