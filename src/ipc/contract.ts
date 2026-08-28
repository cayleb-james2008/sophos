// IPC contract — the shared type surface between the React frontend, the Rust
// Tauri bridge, and the Node bridge sidecar (which owns the daemon connection).
// This is the single source of truth for the JSON-RPC contract. Do not drift.

// ---------------------------------------------------------------------------
// Commands (frontend -> sidecar, via Rust)
// ---------------------------------------------------------------------------

export type IpcCommand =
  | { method: "prompt"; params: { text: string; options?: PromptOptions } }
  | { method: "abort"; params: Record<string, never> }
  | { method: "steer"; params: { text: string } }
  | {
      method: "setModel";
      params: {
        provider: string;
        model: string;
        thinking?: string;
        serviceTier?: string;
        transport?: string;
        contextWindow?: number;
        maxOutputTokens?: number;
      };
    }
  | { method: "newSession"; params: { cwd?: string; goal?: string } }
  | { method: "switchSession"; params: { id: string } }
  | { method: "resumeSession"; params: { pathOrId: string } }
  | { method: "forkSession"; params: { pathOrId: string } }
  | { method: "listSessions"; params: Record<string, never> }
  | { method: "listAgents"; params: Record<string, never> }
  | { method: "attachAgent"; params: { id: string } }
  | { method: "detachAgent"; params: { id: string } }
  | { method: "getState"; params: Record<string, never> }
  | { method: "getTranscript"; params: Record<string, never> }
  | { method: "getModels"; params: Record<string, never> }
  | { method: "getProviders"; params: Record<string, never> }
  | { method: "login"; params: { provider: string; apiKey?: string } }
  | { method: "logout"; params: { provider: string } }
  | { method: "getSettings"; params: Record<string, never> }
  | { method: "setSettings"; params: { settings: Record<string, unknown> } }
  | { method: "runCommand"; params: { command: string; args?: string[] } }
  | { method: "getContextStats"; params: Record<string, never> }
  | { method: "getRlmChildren"; params: Record<string, never> }
  | { method: "sendAgentMessage"; params: { agentId: string; message: string } }
  | { method: "listInbox"; params: Record<string, never> }
  | { method: "markMessageRead"; params: { messageId: string } }
  | { method: "compact"; params: { prompt?: string } }
  | { method: "retry"; params: Record<string, never> }
  | { method: "refine"; params: Record<string, never> }
  | { method: "exportSession"; params: { format?: string } }
  | { method: "shareSession"; params: Record<string, never> }
  | { method: "getSessionTree"; params: Record<string, never> }
  | { method: "cloneSession"; params: Record<string, never> }
  | { method: "nameSession"; params: { name: string } }
  | { method: "sideQuestion"; params: { text: string } }
  | { method: "addSchedule"; params: { cron: string; prompt: string } }
  | { method: "removeSchedule"; params: { id: string } }
  | { method: "setHeartbeat"; params: { schedule: string; prompt?: string } }
  | { method: "removeHeartbeat"; params: Record<string, never> }
  | { method: "navigateTree"; params: { entryId: string } }
  | { method: "startSideQuestion"; params: { text: string } }
  | { method: "exportToHtml"; params: { outputPath?: string } }
  | { method: "exportToJsonl"; params: { outputPath?: string } }
  | { method: "setSessionName"; params: { name: string } }
  | { method: "getContextTree"; params: Record<string, never> }
  | { method: "getRuntimeInfo"; params: Record<string, never> }
  | { method: "getKernelState"; params: Record<string, never> }
  | { method: "getHarnessState"; params: Record<string, never> }
  | { method: "getAgentState"; params: { id: string } }
  | {
      method: "createSkill";
      params: { name: string; description: string; content: string; pythonImport?: string };
    }
  | { method: "installSkill"; params: { path: string } }
  | { method: "installExtension"; params: { path: string } }
  | { method: "removeExtension"; params: { path: string } }
  | { method: "getExtensions"; params: Record<string, never> }
  | { method: "testMcpServer"; params: { name: string; command: string; args?: string[] } }
  | { method: "getSlashCommands"; params: Record<string, never> }
  | { method: "getMemoryState"; params: { tier?: MemoryTier } }
  | { method: "searchMemory"; params: { query: string; tier?: MemoryTier; maxResults?: number } }
  | { method: "storeMemory"; params: { entry: Omit<MemoryTierEntry, "id"> } }
  | { method: "recallMemory"; params: { query: string; limit?: number } }
  | { method: "forgetMemory"; params: { id: string } }
  | { method: "createCheckpoint"; params: { label: string; summary?: string } }
  | { method: "restoreCheckpoint"; params: { id: string } }
  | { method: "listCheckpoints"; params: { sessionId?: string } }
  | { method: "getSquadTopology"; params: Record<string, never> }
  | {
      method: "evaluateSquadPiece";
      params: { childId: string; pieceContract: string; bar: string; outputPaths: string[] };
    }
  | { method: "getMcpServers"; params: Record<string, never> }
  | { method: "readMcpResource"; params: { serverName: string; uri: string } }
  | { method: "getMcpPrompt"; params: { serverName: string; name: string; args?: Record<string, string> } }
  | { method: "getSecurityPolicy"; params: Record<string, never> }
  | {
      method: "setSecurityPolicy";
      params: { policy: WorkspaceSecurityPolicy; customBlockedPatterns?: string[] };
    }
  | { method: "analyzeBlastRadius"; params: { command: string; targetFiles?: string[] } }
  | { method: "getSecurityAuditLog"; params: Record<string, never> }
  | { method: "getSquadWorkflow"; params: Record<string, never> }
  | { method: "runSquadWorkflow"; params: { type: SquadWorkflowType; goal: string; bar: string } }
  | { method: "pauseSquadWorkflow"; params: { id: string } }
  | { method: "getTokenBudget"; params: Record<string, never> }
  | {
      method: "compactContext";
      params: { strategy: "semantic-summarize" | "prune-oldest" | "evict-tools" };
    }
  | { method: "listDesktopWindows"; params: Record<string, never> }
  | { method: "inspectDesktopWindow"; params: { windowId: string } }
  | { method: "dispatchDesktopAction"; params: { windowId: string; action: DesktopUiAction } }
  | { method: "captureDesktopScreenshot"; params: { windowId: string } };

export interface PromptOptions {
  thinking?: string;
  /** Queue or steer a prompt while another turn is running, matching the daemon/TUI contract. */
  streamingBehavior?: "steer" | "followUp";
  queueIfBusy?: boolean;
  serviceTier?: string;
  transport?: string;
  goal?: string;
  /**
   * Active agent profile id (v0.7). Additive UI-layer hint: the frontend uses
   * it to flavor demo responses and show the active working style; the bridge
   * and daemon ignore unknown option fields, so nothing upstream changes.
   */
  profile?: string;
  /**
   * Live display flavor of the ACTIVE profile (v0.7.1 Profile Studio). Carried
   * so demo-mode simulation follows the studio draft even before Save; the
   * bridge strips unknown option fields, so it never reaches the daemon.
   */
  profileFlavor?: { name: string; tagline: string; workingStyle: string[]; mode?: string };
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
  | { type: "agent_watch"; event: AgentWatchEvent }
  | { type: "refinement_result"; result: RefinementResult };

export type AgentWatchEvent =
  | { kind: "attached"; childId: string; sessionId: string; state: AgentSessionState }
  | { kind: "detached"; childId: string; sessionId: string; reason?: string }
  | { kind: "status"; childId: string; status: RlmChild["status"]; state: AgentSessionState }
  | { kind: "transcript"; childId: string; state: AgentSessionState; message?: TranscriptMessage }
  | { kind: "message"; childId: string; state: AgentSessionState; message: TranscriptMessage };

export interface AgentMessageReceipt {
  id: string;
  source?: string;
  target: {
    activeSessionId: string;
    sessionId: string;
    sessionName?: string;
    runtimeKind?: string;
  };
  from?: {
    activeSessionId?: string;
    sessionId?: string;
    sessionName?: string;
    clientId?: string;
  };
  message: string;
  deliveryStatus: "delivered" | "queued";
  deliveredAt?: string;
  queuedAt?: string;
  deliveryMode?: "steer";
}

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

/** A skill discovered by the live daemon resource loader. */
export interface RuntimeSkill {
  name: string;
  description?: string;
  filePath?: string;
  source?: string;
}

export interface KernelCell {
  id: string;
  code: string;
  status: "ok" | "error" | "running" | "unknown";
  executionCount?: number;
  output?: string;
  error?: string;
  timestamp?: string;
  variables?: string[];
  imports?: string[];
}

export type KernelHealthReason =
  | "healthy"
  | "starting"
  | "not_started"
  | "bootstrap_failed"
  | "dead"
  | "namespace_unavailable"
  | "browser_preview"
  | "unavailable";

export type KernelHealthAction =
  "none" | "wait" | "run_cell" | "retry" | "restart" | "refresh" | "open_tauri";

export interface KernelHealthDiagnostic {
  reason: KernelHealthReason;
  message: string;
  nextStep: string;
  action: KernelHealthAction;
}

/** Real kernel evidence from the daemon's persistent IPython state and transcript details. */
export interface KernelState {
  status: "configured" | "running" | "unavailable" | "browser-preview";
  persistent: boolean;
  toolAvailable: boolean;
  sessionId?: string;
  executionCount?: number;
  cells: KernelCell[];
  variables: string[];
  imports: string[];
  diagnostic: KernelHealthDiagnostic;
  lastOutput?: string;
  lastError?: string;
}

export interface HarnessEntry {
  id: string;
  kind: "prompt" | "memory" | "skill" | "subagent";
  title: string;
  content: string;
  path?: string;
  scope?: "local" | "global";
  reference?: Record<string, unknown>;
  arguments?: Record<string, unknown>;
  version?: number;
  updatedAt?: string;
}

export interface HarnessRefinement {
  id: string;
  summary?: string;
  trigger?: string;
  changes?: string[];
  outcome?: string;
  timestamp?: string;
  rollbackOf?: string;
}

export interface HarnessState {
  entries: HarnessEntry[];
  refinements: HarnessRefinement[];
  source?: string;
}

// ---------------------------------------------------------------------------
// Multi-Tier Semantic Memory Architecture (OpenViking / Letta / MemGPT)
// ---------------------------------------------------------------------------

export type MemoryTier = "working" | "recall" | "archival";

export interface MemoryTierEntry {
  id: string;
  tier: MemoryTier;
  uri?: string; // e.g. viking://user/default/memories/entity.md
  title: string;
  content: string;
  confidence?: number; // 0.0 - 1.0
  tags?: string[];
  scope?: "local" | "global";
  temporalValidity?: {
    validFrom?: string;
    validTo?: string;
    assertedAt: string;
  };
  source?: string;
  metadata?: Record<string, unknown>;
}

export interface MemoryState {
  working: MemoryTierEntry[];
  recall: MemoryTierEntry[];
  archival: MemoryTierEntry[];
  totalCount: number;
  uriIndex?: string[];
}

// ---------------------------------------------------------------------------
// Durable Session Checkpointing (LangGraph / Temporal / Osmani 2026)
// ---------------------------------------------------------------------------

export interface CheckpointEntry {
  id: string;
  sessionId: string;
  turnIndex: number;
  timestamp: string;
  label: string;
  summary?: string;
  deltaDiff?: string;
  verifiedStatus?: "GREEN" | "UNVERIFIED" | "REFUTED";
  tokenCount?: number;
  stateSnapshot?: {
    activeSessionId?: string;
    workingDirectory?: string;
    goal?: string;
    appliedEditsCount?: number;
  };
}

// ---------------------------------------------------------------------------
// Gauntlet-RLM Squad Topology & Evaluator-Optimizer (Huang et al. / Anthropic)
// ---------------------------------------------------------------------------

export type SquadRole = "worker" | "critic_text" | "critic_vision" | "researcher" | "orchestrator";

export interface BlindCriticRubric {
  goalScore: number; // 0.0 - 1.0
  contractScore: number; // 0.0 - 1.0
  barScore: number; // 0.0 - 1.0
  contractVerdict: "PASS" | "FAIL";
  barVerdict: "PASS" | "FAIL" | "REFUTED";
  quotedDefects: Array<{
    file?: string;
    line?: number;
    defect: string;
    recommendation: string;
  }>;
  reviewRound: number;
  criticRole: "critic_text" | "critic_vision";
  timestamp: string;
}

export interface SquadMemberState {
  id: string;
  role: SquadRole;
  name: string;
  status: "idle" | "working" | "evaluating" | "done" | "error";
  targetPiece?: string;
  reviewRounds?: number;
  latestRubric?: BlindCriticRubric;
  softCriticReplacementCount?: number;
}

export interface SquadTopology {
  orchestrator: SquadMemberState;
  members: SquadMemberState[];
  activeEvaluationRounds: number;
  doomLoopDetected: boolean;
}

/** Live daemon-owned runtime capabilities used by the harness panels. */
export interface RuntimeInfo {
  cwd?: string;
  kernel: {
    /** "configured" means the persistent IPython tool is available; it does not claim a cell is running. */
    status: "configured" | "unavailable" | "browser-preview";
    persistent: boolean;
    toolAvailable: boolean;
    sessionId?: string;
  };
  skills: RuntimeSkill[];
  skillDiagnostics: Array<{ type: string; message: string; path?: string }>;
  extensions: string[];
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
  /** Child's daemon active-session id, required for attach and direct messaging. */
  sessionId?: string;
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

export type LocalProviderKind = "ollama" | "openai-compatible";

/**
 * A local (self-hosted) model endpoint — Ollama or an OpenAI-compatible
 * server. Unlike daemon-discovered cloud providers, this is a user-specified
 * base URL; it is always rendered as a first-class card and persisted to
 * settings (login stores the config, logout removes it).
 */
export interface LocalProviderConfig {
  id: string;
  name: string;
  baseUrl: string;
  kind: LocalProviderKind;
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

export interface AgentSessionState {
  id: string;
  status: string;
  sessionId?: string;
  model?: string;
  summary?: string;
  activity?: string;
  tokenCount?: number;
  toolUseCount?: number;
  transcript: TranscriptMessage[];
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
  /** Thinking level used when a selected model supports reasoning. */
  defaultThinking?: string;
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
  /**
   * Local (Ollama / OpenAI-compatible) endpoint configs, keyed by id. A non-empty
   * array means a local provider is connected; login stores a config here and
   * logout removes it. getSettings/setSettings already carry arbitrary fields,
   * so no new IPC methods are needed.
   */
  localProviders?: LocalProviderConfig[];
  /**
   * Names of discovered skills the user has disabled. A disabled skill is still
   * discovered by the daemon but is dimmed in the Skills panel and excluded from
   * the session's invocable set. Pure settings — the daemon reads it from
   * settings.json, so no new IPC methods are needed.
   */
  disabledSkills?: string[];
  /** Default provider for RLM subagents — persists across sessions. */
  subagentDefaultProvider?: string;
  /** Default model for RLM subagents — persists across sessions. */
  subagentDefaultModel?: string;
  /** Default thinking level for subagents (none/low/medium/high). */
  subagentDefaultThinking?: string;
}

/** A tool registered by an extension (surfaced in the Extensions panel). */
export interface ExtensionTool {
  name: string;
  description?: string;
}

/** A slash command registered by an extension (surfaced in the Extensions panel). */
export interface ExtensionSlashCommand {
  name: string;
  description?: string;
}

/** Rich detail for a configured extension: its registered tools and slash commands. */
export interface ExtensionInfo {
  name: string;
  path: string;
  enabled: boolean;
  tools: ExtensionTool[];
  slashCommands: ExtensionSlashCommand[];
}

/** Result of a connection test for an MCP server (testMcpServer). */
export interface McpTestResult {
  serverName: string;
  connected: boolean;
  latencyMs?: number;
  error?: string;
  tools?: string[];
}

/** A slash command discovered by the daemon or registered by an extension. */
export interface SlashCommand {
  name: string;
  description: string;
  source?: "builtin" | "extension" | "skill";
}

// ---------------------------------------------------------------------------
// Model Context Protocol (MCP) Standard Subsystem (Anthropic MCP v1.2+)
// ---------------------------------------------------------------------------

export interface McpResource {
  uri: string;
  name: string;
  description?: string;
  mimeType?: string;
  size?: number;
  text?: string;
  blob?: string;
}

export interface McpPromptArgument {
  name: string;
  description?: string;
  required?: boolean;
}

export interface McpPromptTemplate {
  name: string;
  description?: string;
  arguments?: McpPromptArgument[];
}

export interface McpToolSchema {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

export interface McpServerDetails {
  name: string;
  command: string;
  args?: string[];
  enabled: boolean;
  status: "connected" | "disconnected" | "error" | "testing";
  latencyMs?: number;
  protocolVersion?: string;
  capabilities?: {
    tools?: boolean;
    resources?: boolean;
    prompts?: boolean;
    logging?: boolean;
  };
  tools: McpToolSchema[];
  resources: McpResource[];
  prompts: McpPromptTemplate[];
  error?: string;
}

// ---------------------------------------------------------------------------
// Autonomous Workspace Security & Blast Radius Governance (SWE-agent)
// ---------------------------------------------------------------------------

export type WorkspaceSecurityPolicy = "strict-sandbox" | "confirm-risky" | "permissive" | "network-isolated";

export type RiskLevel = "low" | "medium" | "high" | "critical";

export interface BlastRadiusReport {
  filesTargeted: number;
  forbiddenPathsHit: string[];
  riskLevel: RiskLevel;
  requiresConfirmation: boolean;
  reasons: string[];
  suggestedAction: string;
}

export interface SecurityAuditEntry {
  id: string;
  timestamp: string;
  command: string;
  policy: WorkspaceSecurityPolicy;
  blastRadius: BlastRadiusReport;
  status: "approved" | "blocked" | "auto-passed" | "rejected";
  actor: string;
}

// ---------------------------------------------------------------------------
// Dynamic Multi-Agent Squad Workflow Engine (LangGraph / AutoGen 0.4)
// ---------------------------------------------------------------------------

export type SquadWorkflowType = "sequential" | "hierarchical" | "consensus" | "custom";

export interface SquadWorkflowNode {
  id: string;
  role: string;
  profileId?: string;
  model?: string;
  status: "idle" | "running" | "completed" | "failed" | "skipped";
  contract?: string;
  outputPreview?: string;
  latencyMs?: number;
  round?: number;
}

export interface SquadWorkflowState {
  id: string;
  name: string;
  type: SquadWorkflowType;
  nodes: SquadWorkflowNode[];
  activeNodeId?: string;
  consensusScore?: number;
  totalRounds: number;
  maxRounds: number;
  barVerdict?: "PASS" | "FAIL" | "REFUTED";
}

// ---------------------------------------------------------------------------
// Context Token Budget & Compaction Optimizer (DSPy / MemGPT)
// ---------------------------------------------------------------------------

export interface TokenBudgetTiers {
  systemPrompt: number;
  toolsAndSchemas: number;
  workingMemory: number;
  episodicRecall: number;
  semanticArchival: number;
  chatHistory: number;
  checkpoints: number;
}

export interface TokenBudgetBreakdown {
  totalTokens: number;
  contextLimit: number;
  usagePercent: number;
  tiers: TokenBudgetTiers;
  autoCompactionThreshold: number;
  compactionSavingsTokens?: number;
}

// ---------------------------------------------------------------------------
// Native Windows Computer-Use Action Space (CUA & UIA)
// ---------------------------------------------------------------------------

export interface DesktopWindowBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DesktopWindowInfo {
  id: string;
  title: string;
  processName: string;
  pid: number;
  bounds: DesktopWindowBounds;
  isMinimized: boolean;
  isVisible: boolean;
}

export interface DesktopUiElement {
  id: string;
  name: string;
  role: string;
  bounds: DesktopWindowBounds;
  isEnabled: boolean;
  isFocused: boolean;
  children?: DesktopUiElement[];
}

export interface DesktopUiAction {
  kind: "click" | "type" | "keypress" | "hover" | "scroll";
  targetElementId?: string;
  x?: number;
  y?: number;
  text?: string;
  key?: string;
}

export interface DesktopActionResult {
  success: boolean;
  durationMs: number;
  message: string;
  screenshot?: string;
}
