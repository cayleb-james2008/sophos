// mockClient.ts — the browser-preview / demo-mode IPC client (MockIpcClient).
// Extracted from client.ts so the real Tauri client and the demo mock live in
// separate, reviewable modules. client.ts re-exports MockIpcClient for
// backward compatibility with existing imports.

import { buildCodeModeTurn } from "../features/code/demoTurn";
import {
  customDemoFlavor,
  isCustomId,
  parseCustomProfiles,
  type CustomProfile,
} from "../features/studio/store";
import type { IpcClient } from "./client";
import type {
  AgentInfo,
  AgentMessage,
  AgentMessageReceipt,
  ConnectionState,
  AgentSessionState,
  BlindCriticRubric,
  CheckpointEntry,
  ContextTreeNode,
  ExtensionInfo,
  HarnessState,
  IpcEvent,
  KernelState,
  LocalProviderConfig,
  McpResource,
  McpServerDetails,
  McpTestResult,
  MemoryState,
  MemoryTier,
  MemoryTierEntry,
  ModelInfo,
  ModelRuntimeConfig,
  NavigateTreeResult,
  ProviderInfo,
  RefinementResult,
  RuntimeInfo,
  RuntimeSkill,
  ScheduleInfo,
  SecurityAuditEntry,
  SessionInfo,
  SessionTree,
  Settings,
  SlashCommand,
  SquadTopology,
  SquadWorkflowState,
  SquadWorkflowType,
  TokenBudgetBreakdown,
  TranscriptMessage,
  WorkspaceSecurityPolicy,
  BlastRadiusReport,
  DesktopActionResult,
  DesktopUiAction,
  DesktopUiElement,
  DesktopWindowInfo,
  DistilledSkill,
  ThoughtNode,
  ThoughtTreeState,
  WorkspaceTwin,
  TwinDiffReport,
  TwinExecResult,
} from "./contract";

// ---------------------------------------------------------------------------
// Browser fallback (dev without Tauri) — returns neutral data and simulates a
// connection lifecycle (connecting -> connected) so the shell's live status
// indicator is demonstrable in the browser preview.
// ---------------------------------------------------------------------------

const LOCAL_MODEL_CONFIG_KEY = "prime-agent.modelConfig.v1";
const LOCAL_PROVIDER_KEY = "prime-agent.localProviders.v1";
const LOCAL_SETTINGS_KEY = "prime-agent.settings.v1";

/** Demo MCP server shipped connected so the Code Mode SDK registry includes
 * MCP tools (via testMcpServer) in demo mode. It's additive to settings and
 * the Settings e2e suite's clear-loop removes it like any other server. */
const DEMO_MCP_SERVERS = [
  { name: "demo-fs", command: "npx", args: ["-y", "@modelcontextprotocol/server-filesystem"], enabled: true },
];

/** Settings keys whose persisted value is only valid as a string. */
const MOCK_STRING_SETTING_KEYS = [
  "shellPath",
  "sessionDir",
  "defaultCwd",
  "defaultProvider",
  "defaultModel",
  "defaultThinking",
  "daemonCliPath",
  "subagentDefaultProvider",
  "subagentDefaultModel",
  "subagentDefaultThinking",
  "agentProfile",
] as const;

const MOCK_THEMES = ["dark", "light", "system"] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Deep-sanitize settings loaded from demo-mode localStorage.
 *
 * The demo mock is the only surface that persists arbitrary settings shapes,
 * and the WebView2 profile is shared across installed app + demo launches, so
 * stale/foreign values (a non-string `defaultProvider`, non-array
 * `mcpServers`, …) must degrade to clean defaults instead of crashing the UI
 * — a regression where `defaultProvider: {…}` crashed ProviderGlyph and
 * blanked the whole app through the ErrorBoundary, reddening Settings e2e.
 * Unknown keys are dropped: only the known Settings surface is trusted.
 */
export function sanitizeMockSettings(raw: unknown): Settings {
  const input = isRecord(raw) ? raw : {};
  const out: Record<string, unknown> = {};
  for (const key of MOCK_STRING_SETTING_KEYS) {
    const value = input[key];
    if (typeof value === "string") out[key] = value;
  }
  const theme = input.theme;
  if (typeof theme === "string" && (MOCK_THEMES as readonly string[]).includes(theme)) {
    out.theme = theme;
  }
  if (typeof input.daemonTcp === "boolean") out.daemonTcp = input.daemonTcp;
  if (Array.isArray(input.disabledSkills)) {
    out.disabledSkills = input.disabledSkills.filter((v): v is string => typeof v === "string");
  }
  if (Array.isArray(input.localProviders)) {
    out.localProviders = input.localProviders.filter(
      (v): v is LocalProviderConfig =>
        isRecord(v) &&
        typeof v.id === "string" &&
        typeof v.name === "string" &&
        typeof v.baseUrl === "string" &&
        (v.kind === "ollama" || v.kind === "openai-compatible"),
    );
  }
  if (Array.isArray(input.mcpServers)) {
    out.mcpServers = input.mcpServers.filter(
      (v): v is { name: string; command: string; args?: string[]; enabled: boolean } =>
        isRecord(v) &&
        typeof v.name === "string" &&
        typeof v.command === "string" &&
        (v.args === undefined || (Array.isArray(v.args) && v.args.every((a) => typeof a === "string"))) &&
        typeof v.enabled === "boolean",
    );
  }
  if (Array.isArray(input.customProfiles)) {
    out.customProfiles = input.customProfiles.filter(
      (v): v is Record<string, unknown> => isRecord(v) && typeof v.name === "string",
    );
  }
  if (isRecord(input.auth)) {
    out.auth = Object.fromEntries(
      Object.entries(input.auth).filter(([, value]) => typeof value === "string" && value.length > 0),
    );
  }
  if (isRecord(input.modelConfig)) {
    out.modelConfig = Object.fromEntries(
      Object.entries(input.modelConfig).filter(([, value]) => isRecord(value)),
    );
  }
  return out as Settings;
}

function readLocalSettings(): Settings {
  try {
    const raw = typeof window !== "undefined" ? window.localStorage.getItem(LOCAL_SETTINGS_KEY) : null;
    if (!raw) return {};
    return sanitizeMockSettings(JSON.parse(raw));
  } catch {
    return {};
  }
}

function writeLocalSettings(value: Settings): void {
  try {
    if (typeof window !== "undefined") window.localStorage.setItem(LOCAL_SETTINGS_KEY, JSON.stringify(value));
  } catch {
    // Browser preview persistence is best-effort.
  }
}

const INITIAL_LOCAL_SETTINGS = readLocalSettings();

/** Read the mock's persisted model overrides from localStorage (survives reload). */
function readLocalModelConfig(): Record<string, ModelRuntimeConfig> {
  try {
    const raw = typeof window !== "undefined" ? window.localStorage.getItem(LOCAL_MODEL_CONFIG_KEY) : null;
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!isRecord(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).filter(([, value]) => isRecord(value))) as Record<
      string,
      ModelRuntimeConfig
    >;
  } catch {
    return {};
  }
}

/** Persist the mock's model overrides to localStorage so a page reload keeps them. */
function writeLocalModelConfig(value: Record<string, ModelRuntimeConfig>): void {
  try {
    if (typeof window !== "undefined")
      window.localStorage.setItem(LOCAL_MODEL_CONFIG_KEY, JSON.stringify(value));
  } catch {
    // ignore quota/security errors — persistence is best-effort in the mock
  }
}

/** Read the mock's persisted local provider configs from localStorage. Returns
 * `null` when the key was never written, so the mock can default to a connected
 * local endpoint (matching the cloud-provider convention) instead of an empty
 * "logged out" state on a first-ever load. */
function readLocalProviders(): LocalProviderConfig[] | null {
  try {
    const raw = typeof window !== "undefined" ? window.localStorage.getItem(LOCAL_PROVIDER_KEY) : null;
    if (raw === null) return null; // never persisted → treat as not-yet-configured
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    return parsed.filter(
      (v): v is LocalProviderConfig =>
        isRecord(v) &&
        typeof v.id === "string" &&
        typeof v.name === "string" &&
        typeof v.baseUrl === "string" &&
        (v.kind === "ollama" || v.kind === "openai-compatible"),
    );
  } catch {
    return null;
  }
}

/** Persist the mock's local provider configs to localStorage (best-effort). */
function writeLocalProviders(value: LocalProviderConfig[]): void {
  try {
    if (typeof window !== "undefined") window.localStorage.setItem(LOCAL_PROVIDER_KEY, JSON.stringify(value));
  } catch {
    // ignore quota/security errors — persistence is best-effort in the mock
  }
}

/**
 * Default local endpoint config. The mock ships it connected by default,
 * mirroring the cloud-provider convention (everything connected so the demo
 * looks alive). The local card renders separately from getProviders() — it is
 * a user-specified endpoint, not a daemon-discovered provider — so adding it
 * here never shifts the provider-array indices the e2e tests rely on.
 */
const LOCAL_DEFAULT_CONFIG: LocalProviderConfig = {
  id: "local",
  name: "My Local Model",
  baseUrl: "http://localhost:11434",
  kind: "ollama",
};

export class MockIpcClient implements IpcClient {
  private listeners: Array<(e: IpcEvent) => void> = [];
  private mockSettings: Settings & {
    mcpServers?: Array<{ name: string; command: string; args?: string[]; enabled: boolean }>;
  } = {
    ...INITIAL_LOCAL_SETTINGS,
    theme: INITIAL_LOCAL_SETTINGS.theme ?? "dark",
    modelConfig: { ...(INITIAL_LOCAL_SETTINGS.modelConfig ?? {}), ...readLocalModelConfig() },
    localProviders: readLocalProviders() ?? [LOCAL_DEFAULT_CONFIG],
    // Persisted settings win; a fresh demo ships one connected MCP server so
    // the Code Mode registry has MCP tools without a live daemon.
    mcpServers:
      (INITIAL_LOCAL_SETTINGS as Settings & { mcpServers?: typeof DEMO_MCP_SERVERS }).mcpServers ??
      DEMO_MCP_SERVERS,
  };
  private state: ConnectionState = {
    status: { kind: "connecting" },
    model: {
      provider: this.mockSettings.defaultProvider ?? "ollama-cloud",
      model: this.mockSettings.defaultModel ?? "deepseek-v4-flash:0731-cloud",
      thinking: this.mockSettings.defaultThinking,
    },
    activeSessionId: "session-0",
    goals: [
      {
        id: "goal-demo",
        objective: "Ship the release and verify every published artifact",
        status: "active",
        progress: "3 of 5 artifacts verified",
      },
    ],
    context: { tokens: 18432, contextWindow: 1000000, messages: 42 },
    rlmChildren: [
      {
        id: "rlm-1",
        name: "api-reviewer",
        status: "running",
        parentId: "session-0",
        summary: "Reviewing endpoint contracts",
      },
    ],
    schedules: [
      {
        id: "sched-1",
        cron: "0 9 * * *",
        prompt: "Send the morning standup summary to the team channel",
        active: true,
      },
    ],
    heartbeats: [{ id: "hb-1", interval: "*/15 * * * *", active: true }],
    autonomousConfig: {
      active: false,
      maxTurns: 12,
      maxTokens: 80000,
      maxTime: "30m",
      qualityGates: ["npm run build", "npm test"],
    },
    costStats: { totalCost: 0.84, inputTokens: 421337, outputTokens: 118204, sessionCost: 0.31 },
  };
  private simulated = false;
  private timers: number[] = [];

  /** Demo skills surfaced by the browser-preview runtime so the Skills panel
   * has something to render and the enable/disable + "Just installed" flows are
   * demonstrable without a live daemon. */
  private mockSkills: RuntimeSkill[] = [
    { name: "release-audit", description: "Audit a release artifact", source: "project" },
    { name: "code-review", description: "Review code for quality", source: "global" },
    { name: "websearch", description: "Search the web for current information", source: "built-in" },
  ];
  private mockExtensions: Array<{ name: string; path: string; enabled: boolean }> = [
    { name: "github-integration", path: "~/.pi/agent/extensions/github-integration", enabled: true },
    { name: "linear-sync", path: "~/.pi/agent/extensions/linear-sync", enabled: true },
  ];

  /** Demo relay messages surfaced by listInbox() so the Inbox renders an
   * actual message flow (sender → preview → timestamp) with unread/read state
   * in demo mode instead of an empty relay. markMessageRead round-trips here.
   * The peers are the RLM children the fleet surfaces (api-reviewer,
   * test-runner) so the Inbox switcher stays consistent with the Agents view. */
  private mockInboxMessages: AgentMessage[] = [
    {
      id: "in-api-1",
      fromAgentId: "rlm-1",
      fromAgentName: "api-reviewer",
      toAgentId: "self",
      toAgentName: "You",
      text: "Endpoint review approved",
      timestamp: new Date(Date.now() - 90 * 60000).toISOString(),
      read: false,
    },
    {
      id: "out-api-1",
      fromAgentId: "self",
      fromAgentName: "You",
      toAgentId: "rlm-1",
      toAgentName: "api-reviewer",
      text: "Please check the new schema",
      timestamp: new Date(Date.now() - 120 * 60000).toISOString(),
      read: true,
    },
    {
      id: "in-test-1",
      fromAgentId: "rlm-2",
      fromAgentName: "test-runner",
      toAgentId: "self",
      toAgentName: "You",
      text: "Suite green on 3 targets",
      timestamp: new Date(Date.now() - 45 * 60000).toISOString(),
      read: false,
    },
  ];

  /** Rich per-extension detail (registered tools + slash commands) surfaced by
   * getExtensions() so the Extensions panel can render them in the browser
   * preview without a live daemon. Kept consistent with mockExtensions so the
   * configured list, the live daemon paths, and the rich detail all line up. */
  private mockExtensionDetails: ExtensionInfo[] = [
    {
      name: "github-integration",
      path: "~/.pi/agent/extensions/github-integration",
      enabled: true,
      tools: [
        { name: "create_issue", description: "Create a GitHub issue" },
        { name: "list_prs", description: "List open pull requests" },
      ],
      slashCommands: [{ name: "issue", description: "Create or view GitHub issues" }],
    },
    {
      name: "linear-sync",
      path: "~/.pi/agent/extensions/linear-sync",
      enabled: true,
      tools: [{ name: "create_task", description: "Create a Linear task" }],
      slashCommands: [{ name: "linear", description: "Manage Linear tasks" }],
    },
  ];

  /** Builtin slash commands surfaced by getSlashCommands() so the composer's
   * inline autocomplete is demonstrable in the browser preview without a live
   * daemon. Derived from the prime-agent reference's builtin command set. */
  private mockSlashCommands: SlashCommand[] = [
    { name: "refine", description: "Refine the session's goal and plan", source: "builtin" },
    { name: "compact", description: "Compact the session context", source: "builtin" },
    { name: "retry", description: "Retry the last failed operation", source: "builtin" },
    { name: "goal", description: "Set or update the session goal", source: "builtin" },
    { name: "autonomous", description: "Toggle autonomous execution mode", source: "builtin" },
    { name: "heartbeat", description: "Set or view a persistent heartbeat", source: "builtin" },
    { name: "schedule", description: "View or schedule recurring tasks", source: "builtin" },
    { name: "skills", description: "List and manage available skills", source: "builtin" },
    { name: "effort", description: "Select reasoning/thinking level", source: "builtin" },
    { name: "fast", description: "Toggle Fast mode", source: "builtin" },
    { name: "export", description: "Export session to HTML or JSONL", source: "builtin" },
    { name: "share", description: "Share session as a GitHub gist", source: "builtin" },
    { name: "copy", description: "Copy last agent message to clipboard", source: "builtin" },
    { name: "btw", description: "Ask an inline side question", source: "builtin" },
    { name: "side", description: "Ask an inline side question (alias of /btw)", source: "builtin" },
    { name: "name", description: "Set or show the session display name", source: "builtin" },
    { name: "tree", description: "Navigate session tree (switch branches)", source: "builtin" },
    { name: "clone", description: "Duplicate the current session", source: "builtin" },
    { name: "fork", description: "Create a new fork from a previous message", source: "builtin" },
    { name: "context", description: "Show token, cost, and context usage", source: "builtin" },
    { name: "usage", description: "Show token and cost breakdown", source: "builtin" },
    { name: "hotkeys", description: "Show all keyboard shortcuts", source: "builtin" },
    { name: "changelog", description: "Show changelog entries", source: "builtin" },
    { name: "mcp", description: "Open MCP connections or manage MCP integrations", source: "builtin" },
    { name: "model", description: "Select model (opens selector UI)", source: "builtin" },
    { name: "new", description: "Start a new session", source: "builtin" },
    { name: "settings", description: "Open settings menu", source: "builtin" },
    { name: "login", description: "Configure provider authentication", source: "builtin" },
    { name: "logout", description: "Remove provider authentication", source: "builtin" },
    { name: "reload", description: "Reload keybindings, extensions, skills, and prompts", source: "builtin" },
    { name: "help", description: "Show command help", source: "builtin" },
  ];

  // The active session is the one surfaced by the UI. Keeping a single object
  // on the mock makes enrichment (context / goals / rlm / transcript) coherent
  // across the views without fabricating per-session data — only the active
  // session carries context, matching the real daemon's scope.
  private activeSessionId = "session-0";

  /**
   * Mutable session list. Starts with the three demo sessions; newSession /
   * forkSession / cloneSession append to it so the demo mode round-trips
   * session creation through the UI (the graph re-renders with the new node).
   */
  private mockSessions: SessionInfo[] = [
    {
      id: "session-0",
      title: "Refactor auth module",
      status: "active",
      cwd: "C:\\work\\api-service",
      createdAt: new Date(Date.now() - 3600000).toISOString(),
      updatedAt: new Date().toISOString(),
    },
    {
      id: "session-1",
      title: "Migrate to new config schema",
      status: "saved",
      cwd: "C:\\work\\infra",
      createdAt: new Date(Date.now() - 86400000).toISOString(),
      updatedAt: new Date(Date.now() - 86400000).toISOString(),
    },
    {
      id: "session-2",
      title: "Sophos — Windows",
      status: "idle",
      cwd: "C:\\work\\sophos",
      createdAt: new Date(Date.now() - 172800000).toISOString(),
    },
  ];

  /** Append a freshly created session to the demo list and make it active. */
  private createMockSession(title: string, cwd?: string): string {
    const id = `session-${Date.now()}`;
    this.mockSessions = [
      ...this.mockSessions,
      {
        id,
        title,
        status: "active",
        cwd: cwd ?? "",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ];
    this.activeSessionId = id;
    this.state = { ...this.state, activeSessionId: id };
    return id;
  }

  onEvent(cb: (event: IpcEvent) => void): () => void {
    this.listeners.push(cb);
    this.startSimulation();
    return () => {
      this.listeners = this.listeners.filter((l) => l !== cb);
    };
  }

  private emit(e: IpcEvent) {
    this.listeners.forEach((l) => l(e));
  }

  private startSimulation() {
    if (this.simulated) return;
    this.simulated = true;
    // connecting is already the initial state; emit it, then connect.
    this.emit({ type: "connection_status", status: { kind: "connecting" } });
    this.timers.push(
      window.setTimeout(() => {
        this.state = { ...this.state, status: { kind: "connected" } };
        this.emit({ type: "connection_status", status: { kind: "connected" } });
        this.emit({ type: "snapshot", state: this.state });
      }, 600),
    );
  }

  /** Timers for the in-flight simulated chat turn (streaming assistant reply).
   * Tracked separately from the connection `timers` so abort()/a new prompt
   * can stop the current simulated turn without touching connect state. */
  private chatTurnTimers: number[] = [];

  /** Clear any in-flight simulated chat turn timers. */
  private clearChatTurn(): void {
    this.chatTurnTimers.forEach((t) => window.clearTimeout(t));
    this.chatTurnTimers = [];
  }

  /** Resolve a custom profile from the mock's persisted settings (guarded). */
  private customById(id: string | undefined): CustomProfile | undefined {
    if (!id || !isCustomId(id)) return undefined;
    const stored = (this.mockSettings as Settings & { customProfiles?: unknown }).customProfiles;
    return parseCustomProfiles(stored).find((p) => p.id === id);
  }

  async prompt(
    text: string,
    options?: {
      profile?: string;
      profileFlavor?: { name: string; tagline: string; workingStyle: string[]; mode?: string };
    },
  ): Promise<void> {
    this.emit({ type: "session_event", event: { kind: "user_message", text } });
    this.simulateChatTurn(text, options?.profile, options?.profileFlavor);
  }
  async abort(): Promise<void> {
    // Stop any in-flight simulated streaming turn (matches the real daemon).
    this.clearChatTurn();
  }
  async steer(text: string): Promise<void> {
    // A steer is delivered to the (simulated) running turn and gets its own
    // acknowledgement so the steered indicator round-trips in demo mode.
    this.emit({
      type: "session_event",
      event: {
        kind: "text",
        text: `\n\n[steered] noted — I'll address “${text.trim()}” after the current tool calls.`,
      },
    });
  }

  /**
   * Simulate a full streaming assistant turn in response to the user's prompt.
   * Emits thinking → tool call → answer deltas through the same session-event
   * channel the real daemon uses (useTranscript.applySessionEvent), then a
   * snapshot marking the queue idle so the composer's busy state clears. This
   * makes the core Chat messaging + streaming features demonstrable/testable
   * in demo mode via cua-driver.
   */
  private simulateChatTurn(
    text: string,
    profile?: string,
    profileFlavor?: { name: string; tagline: string; workingStyle: string[]; mode?: string },
  ): void {
    this.clearChatTurn();
    // Code Mode: the simulated turn writes ONE program that calls several
    // tools and emits run_code + tool_call/tool_result events, so the Code
    // Mode panel decomposes it into tool-call cards and the Trajectory log
    // records the program and each call — all clearly labeled simulated. A
    // custom profile whose base mode is "code" runs the same turn.
    if (profile === "code" || profileFlavor?.mode === "code" || this.customById(profile)?.mode === "code") {
      this.simulateCodeTurn(text);
      return;
    }
    const shown = (text.trim() || "(empty message)").slice(0, 140);
    const push = (fn: () => void, ms: number) => {
      this.chatTurnTimers.push(window.setTimeout(fn, ms));
    };
    const e = (event: Record<string, unknown>) => this.emit({ type: "session_event", event } as IpcEvent);

    // Mark the turn as running so the composer's daemonIdle (busy-clearing)
    // effect sees a queue-idle transition at the END of the turn. Without this
    // the queue stays idle across turns and the transition never fires again.
    this.emit({ type: "snapshot", state: { ...this.state, queue: { mode: "busy" } } });

    // Thinking.
    push(() => e({ kind: "thinking_delta", thinking: "Reading your message…" }), 350);
    push(() => e({ kind: "thinking_delta", thinking: " `" + shown + "`" }), 1600);
    // A running demo tool call, then its result.
    push(
      () =>
        e({
          kind: "tool_call",
          name: "demo_echo",
          input: JSON.stringify({ text: text.trim() }),
        }),
      2600,
    );
    push(
      () =>
        e({
          kind: "tool_result",
          name: "demo_echo",
          output: `Demo: echoed user input (${shown.length} chars) — no live tool available.`,
        }),
      3600,
    );
    // Stream the answer in chunks. When the active profile is Gauntlet, append
    // its plain-English status block so the profile visibly changes how the
    // agent reports (goal + bar, honest evidence markers) — the e2e anchor
    // strings above stay intact either way. Custom profiles append their live
    // draft flavor (follows the studio before Save via profileFlavor, or the
    // persisted profile from settings).
    const profileBlock =
      profile === "gauntlet"
        ? "\n\nStatus — demo run (simulated response; evidence is a UI round-trip, not a live tool run)\nVerified — the message loop round-tripped and this reply rendered in your conversation\nUnverified — nothing was actually executed — no live engine is connected, so no real tool ran and no real data was fetched\nNext action — connect an engine (or start a local model server), then re-run this prompt for a real result"
        : isCustomId(profile ?? "")
          ? customDemoFlavor(profileFlavor ?? this.customById(profile))
          : "";
    const chunks = [
      `Got it — you said: “${shown}”.`,
      "\n\nThis is a simulated demo response — no live engine is connected, so I can't run real tools or fetch live data.",
      "\n\nIn the connected app I'd help you work through it step by step.",
      profileBlock,
    ].filter(Boolean);
    chunks.forEach((chunk, i) => {
      push(() => e({ kind: "text", text: chunk }), 4400 + i * 1100);
    });
    // Mark the turn complete → queue idle so busy clears + follow-ups flush.
    push(
      () => {
        this.emit({ type: "snapshot", state: { ...this.state, queue: { mode: "idle" } } });
        this.clearChatTurn();
      },
      4400 + chunks.length * 1100 + 500,
    );
  }

  /**
   * Code-mode simulated turn (Tauri demo shell). Builds the deterministic
   * run_code program from the user's ACTUAL input and streams it through the
   * same session_event channel the real daemon uses: run_code (the program),
   * one tool_call/tool_result pair per call, run_complete, then the answer.
   * Every output is labeled demo/simulated — no live tool claim.
   */
  private simulateCodeTurn(text: string): void {
    this.clearChatTurn();
    const shown = (text.trim() || "(empty message)").slice(0, 140);
    const push = (fn: () => void, ms: number) => {
      this.chatTurnTimers.push(window.setTimeout(fn, ms));
    };
    const e = (event: Record<string, unknown>) => this.emit({ type: "session_event", event } as IpcEvent);

    this.emit({ type: "snapshot", state: { ...this.state, queue: { mode: "busy" } } });

    const { program, calls } = buildCodeModeTurn(text);
    const runId = `code-run-${Date.now()}`;

    push(() => e({ kind: "thinking_delta", thinking: "Reading your message…" }), 350);
    push(
      () =>
        e({
          kind: "thinking_delta",
          thinking: " Code mode: compiling ONE program that calls several tools.",
        }),
      1600,
    );
    push(() => e({ kind: "run_code", runId, program }), 2600);
    calls.forEach((c, i) => {
      push(
        () => e({ kind: "tool_call", runId, name: c.name, input: JSON.stringify(c.input) }),
        3200 + i * 700,
      );
      push(() => e({ kind: "tool_result", runId, name: c.name, output: c.output }), 3200 + i * 700 + 600);
    });
    push(() => e({ kind: "run_complete", runId }), 3200 + calls.length * 700 + 800);

    const chunks = [
      `Got it — you said: “${shown}”.`,
      "\n\nThis is a simulated demo response — no live engine is connected, so the run_code program and its tool calls are simulated; no real tool ran and no real data was fetched.",
      `\n\nI ran one program with ${calls.length} tool calls (${calls.map((c) => c.name).join(", ")}) — each decomposed into its own tool-call card in the Code Mode panel and recorded in the Trajectory log.`,
    ];
    // The answer streams AFTER the run completes (run_complete lands at
    // 3200 + calls*700 + 800), so the transcript order matches the browser
    // preview path: program → tool calls → run complete → answer.
    const answerStart = 3200 + calls.length * 700 + 900;
    chunks.forEach((chunk, i) => {
      push(() => e({ kind: "text", text: chunk }), answerStart + i * 1100);
    });
    push(
      () => {
        this.emit({ type: "snapshot", state: { ...this.state, queue: { mode: "idle" } } });
        this.clearChatTurn();
      },
      answerStart + chunks.length * 1100 + 500,
    );
  }
  async setModel(
    provider: string,
    model: string,
    _thinking?: string,
    runtime?: ModelRuntimeConfig,
  ): Promise<void> {
    if (runtime) {
      this.applyModelRuntime(provider, model, runtime);
    }
    this.mockSettings = {
      ...this.mockSettings,
      defaultProvider: provider,
      defaultModel: model,
      ...(_thinking ? { defaultThinking: _thinking } : {}),
    };
    writeLocalSettings(this.mockSettings);
    this.state = { ...this.state, model: { provider, model, thinking: _thinking } };
    this.emit({ type: "snapshot", state: this.state });
  }

  /** Reflect a runtime override in the model catalog + connection context. */
  private applyModelRuntime(provider: string, model: string, runtime: ModelRuntimeConfig): void {
    this.mockModels = this.mockModels.map((m) =>
      m.provider === provider && m.id === model
        ? {
            ...m,
            contextWindow: runtime.contextWindow ?? m.contextWindow,
            maxOutputTokens: runtime.maxOutputTokens ?? m.maxOutputTokens,
          }
        : m,
    );
    if (runtime.contextWindow != null) {
      this.state = {
        ...this.state,
        context: { ...(this.state.context ?? {}), contextWindow: runtime.contextWindow },
      };
    }
    this.emit({ type: "snapshot", state: this.state });
  }
  async newSession(_cwd?: string, goal?: string): Promise<void> {
    this.createMockSession("New session", _cwd);
    if (goal) {
      this.state = {
        ...this.state,
        goals: [{ id: `goal-${Date.now()}`, objective: goal, status: "active" as const }],
      };
    }
    this.emit({ type: "snapshot", state: this.state });
  }
  async switchSession(id: string): Promise<void> {
    this.activeSessionId = id;
    this.state = { ...this.state, activeSessionId: id };
    this.emit({ type: "snapshot", state: this.state });
  }
  async resumeSession(pathOrId: string): Promise<void> {
    this.activeSessionId = pathOrId;
    this.state = { ...this.state, activeSessionId: pathOrId };
    this.emit({ type: "snapshot", state: this.state });
  }
  async forkSession(_pathOrId: string): Promise<void> {
    this.createMockSession("Forked session");
    this.emit({ type: "snapshot", state: this.state });
  }
  async listSessions(): Promise<SessionInfo[]> {
    return this.mockSessions;
  }
  async listAgents(): Promise<AgentInfo[]> {
    return [];
  }
  async attachAgent(id: string): Promise<{ childId: string; sessionId: string; attached: true }> {
    const state = await this.getAgentState(id);
    this.emit({ type: "agent_watch", event: { kind: "attached", childId: id, sessionId: id, state } });
    return { childId: id, sessionId: id, attached: true };
  }
  async detachAgent(id: string): Promise<void> {
    this.emit({
      type: "agent_watch",
      event: { kind: "detached", childId: id, sessionId: id, reason: "detached" },
    });
  }
  async getState(): Promise<ConnectionState> {
    return {
      ...this.state,
      goals: this.state.goals ?? [
        {
          id: "goal-demo",
          objective: "Ship the release and verify every published artifact",
          status: "active" as const,
          progress: "3 of 5 artifacts verified",
        },
      ],
      context: { tokens: 18432, contextWindow: this.state.context?.contextWindow ?? 1000000, messages: 42 },
      rlmChildren: [
        {
          id: "rlm-1",
          name: "api-reviewer",
          status: "running" as const,
          parentId: this.state.activeSessionId,
          summary: "Reviewing endpoint contracts",
        },
      ],
      schedules: this.state.schedules ?? [
        {
          id: "sched-1",
          cron: "0 9 * * *",
          prompt: "Send the morning standup summary to the team channel",
          active: true,
        },
      ],
      heartbeats: this.state.heartbeats ?? [{ id: "hb-1", interval: "*/15 * * * *", active: true }],
      autonomousConfig: this.state.autonomousConfig ?? {
        active: false,
        maxTurns: 12,
        maxTokens: 80000,
        maxTime: "30m",
        qualityGates: ["npm run build", "npm test"],
      },
      costStats: this.state.costStats ?? {
        totalCost: 0.84,
        inputTokens: 421337,
        outputTokens: 118204,
        sessionCost: 0.31,
      },
    };
  }
  async getTranscript(): Promise<TranscriptMessage[]> {
    // No real transcript exists in the browser preview. Returning [] lets
    // useChat seed the neutral demo conversation (demoSeed) instead of a fake
    // canned exchange, so the preview doesn't present made-up work as real.
    return [];
  }
  private mockModels: ModelInfo[] = [
    {
      id: "deepseek-v4-flash:0731-cloud",
      name: "DeepSeek V4 Flash 0731",
      provider: "ollama-cloud",
      contextWindow: 1000000,
      maxOutputTokens: 65536,
      maxContextWindow: 1000000,
      maxOutputTokensCeiling: 65536,
    },
    {
      id: "deepseek-v4-flash-free",
      name: "DeepSeek V4 Flash (free)",
      provider: "opencode",
      contextWindow: 1000000,
      maxOutputTokens: 65536,
      maxContextWindow: 1000000,
      maxOutputTokensCeiling: 65536,
    },
    {
      id: "MiniMax-M3",
      name: "MiniMax M3",
      provider: "minimax",
      contextWindow: 524288,
      maxOutputTokens: 128000,
      maxContextWindow: 524288,
      maxOutputTokensCeiling: 128000,
    },
  ];

  async getModels(): Promise<ModelInfo[]> {
    return this.mockModels;
  }
  async getProviders(): Promise<ProviderInfo[]> {
    // Order matters: index 0 stays `ollama-cloud` because the e2e login-flow
    // test patches the first entry to drive the disconnected Connect modal.
    //
    // `prime-intellect` is a **subscription** provider and ships DISCONNECTED
    // on purpose. The OAuth sign-in block in the Connect modal renders only for
    // `kind: "subscription"`, so with an all-api_key, all-connected mock the
    // copyable OAuth link was unreachable in browser-demo mode by any amount of
    // clicking — which is exactly why a design review reported it missing.
    // Shipping one managed provider makes that path reachable normally and
    // keeps it covered by the standing suite.
    return [
      {
        id: "ollama-cloud",
        name: "Ollama Cloud",
        kind: "api_key",
        connected: !this.mockLoggedOut.has("ollama-cloud"),
        models: [],
      },
      {
        id: "openrouter",
        name: "OpenRouter",
        kind: "api_key",
        connected: !this.mockLoggedOut.has("openrouter"),
        models: [],
      },
      {
        id: "minimax",
        name: "MiniMax",
        kind: "api_key",
        connected: !this.mockLoggedOut.has("minimax"),
        models: [],
      },
      {
        id: "opencode",
        name: "Codex (OpenCode)",
        kind: "api_key",
        connected: !this.mockLoggedOut.has("opencode"),
        models: [],
      },
      {
        id: "prime-intellect",
        name: "Prime Intellect",
        kind: "subscription",
        connected: this.mockLoggedIn.has("prime-intellect"),
        models: [],
      },
    ];
  }
  /** Providers the demo user has explicitly signed into this session. */
  private mockLoggedIn = new Set<string>();
  /** Providers the demo user has explicitly signed out of this session. */
  private mockLoggedOut = new Set<string>();
  async login(provider: string): Promise<void> {
    // Make the demo honest: signing in actually flips the provider to
    // connected, so the Connect → modal → connected round-trip is real rather
    // than a no-op that leaves the UI lying about its state.
    if (provider === "local") {
      // A local endpoint has no ambient/daemon auth — connecting stores its
      // config in settings. ProvidersPanel persists the user-entered config
      // via setSettings first; this default guards direct login() calls.
      if (!(this.mockSettings.localProviders ?? []).length) {
        this.mockSettings = { ...this.mockSettings, localProviders: [LOCAL_DEFAULT_CONFIG] };
        writeLocalProviders([LOCAL_DEFAULT_CONFIG]);
      }
    }
    this.mockLoggedIn.add(provider);
    this.mockLoggedOut.delete(provider);
  }
  async logout(provider: string): Promise<void> {
    this.mockLoggedOut.add(provider);
    this.mockLoggedIn.delete(provider);
    if (provider === "local") {
      // Disconnecting a local endpoint removes its config (login stores it,
      // logout removes it).
      this.mockSettings = { ...this.mockSettings, localProviders: [] };
      writeLocalProviders([]);
    }
  }
  async getSettings(): Promise<Settings> {
    return {
      ...this.mockSettings,
      modelConfig: { ...(this.mockSettings.modelConfig ?? {}) },
      extensions: this.mockExtensions,
    } as unknown as Settings;
  }
  async setSettings(settings: Settings): Promise<void> {
    const next = { ...this.mockSettings, ...settings };
    if (settings.modelConfig !== undefined) {
      // Replace (not merge) — mirrors the bridge SettingsStore.update() semantics,
      // so a reset that removes a key actually drops it from the persisted config.
      next.modelConfig = settings.modelConfig;
    }
    if (settings.localProviders !== undefined) {
      next.localProviders = settings.localProviders;
    }
    this.mockSettings = next;
    writeLocalSettings(this.mockSettings);
    writeLocalModelConfig(next.modelConfig ?? {});
    writeLocalProviders(next.localProviders ?? []);
  }
  async runCommand(): Promise<void> {}
  async getContextStats(): Promise<ConnectionState["context"]> {
    return {
      tokens: 18432,
      contextWindow: this.state.context?.contextWindow ?? 1000000,
      messages: 42,
    };
  }
  async getRlmChildren(): Promise<ConnectionState["rlmChildren"]> {
    return [
      {
        id: "rlm-1",
        name: "api-reviewer",
        status: "running" as const,
        parentId: this.activeSessionId,
        summary: "Reviewing endpoint contracts",
      },
      {
        id: "rlm-2",
        name: "test-runner",
        status: "idle" as const,
        parentId: this.activeSessionId,
        summary: "Awaiting next batch",
      },
    ];
  }
  async sendAgentMessage(agentId: string, message: string): Promise<AgentMessageReceipt> {
    return {
      id: `mock-receipt-${Date.now()}`,
      target: { activeSessionId: agentId, sessionId: agentId },
      message,
      deliveryStatus: "delivered",
      deliveredAt: new Date().toISOString(),
    };
  }
  async listInbox(): Promise<AgentMessage[]> {
    return this.mockInboxMessages;
  }
  async markMessageRead(messageId: string): Promise<void> {
    const raw = messageId.startsWith("msg-") ? messageId.slice(4) : messageId;
    this.mockInboxMessages = this.mockInboxMessages.map((m) => (m.id === raw ? { ...m, read: true } : m));
  }
  async compact(_prompt?: string): Promise<void> {}
  async retry(): Promise<void> {}
  async refine(): Promise<void> {
    // Browser preview: emit a demo refinement_result so the review-and-approve
    // gate (A1) is demonstrable without a live daemon. The proposed change is
    // held pending until the user explicitly applies or discards it.
    //
    // P3: the demo edit carries old/new content so the banner renders a REAL
    // unified diff (added/removed lines), not just a text summary. The frozen
    // contract type has no old/new fields, so they ride along at runtime and
    // buildRefinementDiff reads them defensively — production only renders a
    // true diff when the event actually reports the content.
    const oldContent = ["You are Sophos, a focused agent.", "Complete the user's tasks.", "Be concise."].join(
      "\n",
    );
    const newContent = [
      "You are Sophos, a focused agent.",
      "Complete the user's tasks and verify every published artifact.",
      "Be concise and cite your sources.",
    ].join("\n");
    const result = {
      id: `refine-${Date.now()}`,
      summary: "Tighten the session instructions against the stated goal.",
      rationale: "The current instructions drift from the objective; this pass realigns them.",
      expectedOutcome: "More focused continuations on the active goal.",
      appliedEdits: [
        {
          id: "edit-1",
          action: "update",
          kind: "instruction",
          title: "Session instructions",
          path: "session-instructions.md",
          oldContent,
          newContent,
          applied: false,
        },
      ],
    } as unknown as RefinementResult;
    this.emit({ type: "refinement_result", result });
  }
  async exportSession(format?: string): Promise<{ exportedPath?: string }> {
    // Browser preview: report the requested format without a real export.
    return {
      exportedPath: format === "jsonl" ? "mock://session-export.jsonl" : "mock://session-export.html",
    };
  }
  async shareSession(): Promise<void> {}
  async getSessionTree(): Promise<SessionTree> {
    return {
      tree: [
        {
          id: "entry-1",
          type: "message",
          label: "Initial brief",
          timestamp: new Date(Date.now() - 3600000).toISOString(),
          parentId: null,
          children: [
            {
              id: "entry-2",
              type: "message",
              label: "Agent reply",
              timestamp: new Date(Date.now() - 3000000).toISOString(),
              parentId: "entry-1",
            },
          ],
        },
      ],
      leafId: "entry-2",
    };
  }
  async cloneSession(): Promise<{ activeSessionId?: string }> {
    const id = this.createMockSession("Cloned session");
    this.emit({ type: "snapshot", state: this.state });
    return { activeSessionId: id };
  }
  async nameSession(_name: string): Promise<void> {
    // Naming a session is a no-op in the browser preview; state carries no name field.
  }
  async sideQuestion(text: string): Promise<{ id: string }> {
    const id = `side-${Date.now()}`;
    this.emit({ type: "session_event", event: { kind: "side_question_event", id, text, status: "running" } });
    return { id };
  }
  async addSchedule(cron: string, prompt: string): Promise<ScheduleInfo> {
    const s: ScheduleInfo = { id: `sched-${Date.now()}`, cron, prompt, active: true };
    this.state = { ...this.state, schedules: [...(this.state.schedules ?? []), s] };
    this.emit({ type: "snapshot", state: this.state });
    return s;
  }
  async removeSchedule(id: string): Promise<ScheduleInfo> {
    this.state = { ...this.state, schedules: (this.state.schedules ?? []).filter((s) => s.id !== id) };
    this.emit({ type: "snapshot", state: this.state });
    return { id, cron: "", prompt: "", active: false };
  }
  async setHeartbeat(schedule: string, prompt?: string): Promise<ScheduleInfo | undefined> {
    const s: ScheduleInfo = { id: `hb-${Date.now()}`, cron: schedule, prompt: prompt ?? "", active: true };
    this.state = { ...this.state, heartbeats: [{ id: s.id, interval: schedule, active: true }] };
    this.emit({ type: "snapshot", state: this.state });
    return s;
  }
  async removeHeartbeat(): Promise<ScheduleInfo | undefined> {
    this.state = { ...this.state, heartbeats: [] };
    this.emit({ type: "snapshot", state: this.state });
    return undefined;
  }
  async navigateTree(entryId: string): Promise<NavigateTreeResult> {
    return { cancelled: false, editorText: `Navigated to ${entryId} (mock)` };
  }
  async startSideQuestion(text: string): Promise<{ id: string }> {
    const id = `side-${Date.now()}`;
    this.emit({ type: "session_event", event: { kind: "side_question_event", id, text, status: "running" } });
    // Simulate the inline side-turn completing so the panel is fully
    // demonstrable (running → complete with a reply) in demo mode.
    this.chatTurnTimers.push(
      window.setTimeout(() => {
        this.emit({
          type: "session_event",
          event: {
            kind: "side_question_event",
            id,
            text,
            status: "complete",
            answer: `Side reply (demo) — your question: “${text.trim()}”. In the connected app this opens an inline side conversation that doesn't touch the main session.`,
          },
        });
      }, 1300),
    );
    return { id };
  }
  async exportToHtml(outputPath?: string): Promise<{ outputPath: string }> {
    return { outputPath: outputPath ?? "mock://session-export.html" };
  }
  async exportToJsonl(outputPath?: string): Promise<{ outputPath: string }> {
    return { outputPath: outputPath ?? "mock://session-export.jsonl" };
  }
  async setSessionName(_name: string): Promise<void> {
    // No-op in the browser preview; session naming isn't represented in mock state.
  }
  async getContextTree(): Promise<ContextTreeNode> {
    return {
      id: "root",
      label: "Session",
      status: "active",
      children: [{ id: "sub-1", label: "api-reviewer", status: "running", children: [] }],
    };
  }
  async getRuntimeInfo(): Promise<RuntimeInfo> {
    return {
      kernel: { status: "browser-preview", persistent: false, toolAvailable: false },
      skills: this.mockSkills,
      skillDiagnostics: [],
      extensions: this.mockExtensionDetails.map((e) => e.path),
    };
  }
  async getExtensions(): Promise<ExtensionInfo[]> {
    return this.mockExtensionDetails;
  }
  async getKernelState(): Promise<KernelState> {
    return {
      status: "browser-preview",
      persistent: false,
      toolAvailable: false,
      cells: [],
      variables: [],
      imports: [],
      diagnostic: {
        reason: "browser_preview",
        message: "The browser preview has no live Python workspace.",
        nextStep: "Open the Tauri app to inspect the live kernel.",
        action: "open_tauri",
      },
    };
  }
  async getHarnessState(): Promise<HarnessState> {
    return { entries: [], refinements: [], source: "browser-preview" };
  }
  async getAgentState(id: string): Promise<AgentSessionState> {
    return { id, status: "browser-preview", transcript: [] };
  }
  async createSkill(input: {
    name: string;
    description: string;
    content: string;
    pythonImport?: string;
  }): Promise<RuntimeSkill> {
    const skill: RuntimeSkill = {
      name: input.name,
      description: input.description,
      source: "browser-preview",
    };
    this.mockSkills = [...this.mockSkills, skill];
    return skill;
  }
  async installSkill(_path: string): Promise<RuntimeSkill[]> {
    return this.mockSkills;
  }
  async installExtension(path: string): Promise<void> {
    const name = path.split(/[/\\]/).pop() ?? path;
    this.mockExtensions = [...this.mockExtensions, { name, path, enabled: true }];
  }
  async removeExtension(path: string): Promise<void> {
    this.mockExtensions = this.mockExtensions.filter((e) => e.path !== path);
  }
  async testMcpServer(name: string, command: string, _args?: string[]): Promise<McpTestResult> {
    const valid = command && command.trim().length > 0;
    if (!valid) {
      return { serverName: name, connected: false, error: "Command not found" };
    }
    return { serverName: name, connected: true, latencyMs: 42, tools: ["search", "fetch"] };
  }
  async getSlashCommands(): Promise<SlashCommand[]> {
    return this.mockSlashCommands;
  }

  // -------------------------------------------------------------------------
  // Multi-Tier Semantic Memory Architecture (OpenViking / Letta)
  // -------------------------------------------------------------------------

  private mockMemoryEntries: MemoryTierEntry[] = [
    {
      id: "mem-work-1",
      tier: "working",
      title: "Active Modernization Scope",
      content:
        "Modernizing Sophos harness with Code Intelligence, Memory Tiers, Squad Evaluators, and Checkpoints",
      confidence: 1.0,
      tags: ["scope", "modernization", "active"],
      scope: "local",
      temporalValidity: { assertedAt: new Date().toISOString() },
    },
    {
      id: "mem-rec-1",
      tier: "recall",
      title: "Latest Test Suite Run",
      content: "131 test files passed with 100% clean vitest assertions",
      confidence: 0.98,
      tags: ["testing", "vitest", "clean"],
      scope: "local",
      temporalValidity: { assertedAt: new Date(Date.now() - 5 * 60000).toISOString() },
    },
    {
      id: "mem-arch-1",
      tier: "archival",
      uri: "viking://user/default/memories/entities/software_system/sophos.md",
      title: "Sophos Architecture Standard",
      content:
        "Windows-native coding agent desktop app with Tauri v2 Rust shell, JSON-RPC sidecar bridge, and Geist aesthetic",
      confidence: 0.99,
      tags: ["architecture", "tauri", "standards"],
      scope: "global",
      temporalValidity: { validFrom: "2026-08-12", assertedAt: new Date().toISOString() },
    },
  ];

  async getMemoryState(tier?: MemoryTier): Promise<MemoryState> {
    const entries = tier ? this.mockMemoryEntries.filter((e) => e.tier === tier) : this.mockMemoryEntries;
    return {
      working: entries.filter((e) => e.tier === "working"),
      recall: entries.filter((e) => e.tier === "recall"),
      archival: entries.filter((e) => e.tier === "archival"),
      totalCount: entries.length,
      uriIndex: entries.map((e) => e.uri).filter((u): u is string => Boolean(u)),
    };
  }

  async searchMemory(query: string, tier?: MemoryTier, maxResults = 10): Promise<MemoryTierEntry[]> {
    const q = query.toLowerCase();
    return this.mockMemoryEntries
      .filter(
        (e) =>
          (!tier || e.tier === tier) &&
          (e.title.toLowerCase().includes(q) || e.content.toLowerCase().includes(q)),
      )
      .slice(0, maxResults);
  }

  async storeMemory(entry: Omit<MemoryTierEntry, "id">): Promise<MemoryTierEntry> {
    const created: MemoryTierEntry = {
      ...entry,
      id: `mem-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      temporalValidity: entry.temporalValidity ?? { assertedAt: new Date().toISOString() },
    };
    this.mockMemoryEntries = [created, ...this.mockMemoryEntries];
    return created;
  }

  async recallMemory(query: string, limit = 5): Promise<string[]> {
    const hits = await this.searchMemory(query, undefined, limit);
    return hits.map((h) => `[${h.tier.toUpperCase()}] ${h.title}: ${h.content}`);
  }

  async forgetMemory(id: string): Promise<void> {
    this.mockMemoryEntries = this.mockMemoryEntries.filter((e) => e.id !== id);
  }

  // -------------------------------------------------------------------------
  // Durable Session Checkpointing (LangGraph / Temporal)
  // -------------------------------------------------------------------------

  private mockCheckpoints: CheckpointEntry[] = [
    {
      id: "ckpt-init",
      sessionId: "session-0",
      turnIndex: 0,
      timestamp: new Date(Date.now() - 30 * 60000).toISOString(),
      label: "Session Bootstrap",
      summary: "Baseline workspace state before task execution",
      verifiedStatus: "GREEN",
      tokenCount: 1200,
      stateSnapshot: {
        activeSessionId: "session-0",
        workingDirectory: "C:\\Users\\Cayleb\\Desktop\\workspace\\sophos",
        goal: "Modernize harness architecture",
        appliedEditsCount: 0,
      },
    },
  ];

  async createCheckpoint(label: string, summary?: string): Promise<CheckpointEntry> {
    const ckpt: CheckpointEntry = {
      id: `ckpt-${Date.now()}`,
      sessionId: this.state.activeSessionId ?? "session-0",
      turnIndex: this.mockCheckpoints.length,
      timestamp: new Date().toISOString(),
      label,
      summary: summary ?? `Checkpoint at step ${this.mockCheckpoints.length}`,
      verifiedStatus: "GREEN",
      tokenCount: this.state.context?.tokens ?? 18432,
      stateSnapshot: {
        activeSessionId: this.state.activeSessionId,
        workingDirectory: "C:\\Users\\Cayleb\\Desktop\\workspace\\sophos",
        appliedEditsCount: this.mockCheckpoints.length,
      },
    };
    this.mockCheckpoints = [ckpt, ...this.mockCheckpoints];
    return ckpt;
  }

  async restoreCheckpoint(id: string): Promise<CheckpointEntry> {
    const hit = this.mockCheckpoints.find((c) => c.id === id);
    if (!hit) throw new Error(`Checkpoint ${id} not found`);
    return hit;
  }

  async listCheckpoints(sessionId?: string): Promise<CheckpointEntry[]> {
    return sessionId ? this.mockCheckpoints.filter((c) => c.sessionId === sessionId) : this.mockCheckpoints;
  }

  // -------------------------------------------------------------------------
  // Gauntlet-RLM Squad Topology & Evaluator-Optimizer
  // -------------------------------------------------------------------------

  private mockSquadTopology: SquadTopology = {
    orchestrator: {
      id: "orch-1",
      role: "orchestrator",
      name: "Lead Orchestrator",
      status: "working",
      targetPiece: "P1: IPC & Architecture Modernization",
      reviewRounds: 1,
    },
    members: [
      {
        id: "worker-1",
        role: "worker",
        name: "Gauntlet Worker (Code Intelligence)",
        status: "working",
        targetPiece: "P1: IPC & Architecture Modernization",
        reviewRounds: 1,
      },
      {
        id: "critic-1",
        role: "critic_text",
        name: "Blind Text Critic",
        status: "idle",
        targetPiece: "P1: IPC & Architecture Modernization",
        reviewRounds: 1,
        latestRubric: {
          goalScore: 0.96,
          contractScore: 0.95,
          barScore: 0.98,
          contractVerdict: "PASS",
          barVerdict: "PASS",
          quotedDefects: [],
          reviewRound: 1,
          criticRole: "critic_text",
          timestamp: new Date().toISOString(),
        },
      },
      {
        id: "researcher-1",
        role: "researcher",
        name: "Gauntlet Primary Researcher",
        status: "idle",
        targetPiece: "P0: 2026 OSS Architectures",
        reviewRounds: 1,
      },
    ],
    activeEvaluationRounds: 1,
    doomLoopDetected: false,
  };

  async getSquadTopology(): Promise<SquadTopology> {
    return this.mockSquadTopology;
  }

  async evaluateSquadPiece(
    childId: string,
    _pieceContract: string,
    _bar: string,
    _outputPaths: string[],
  ): Promise<BlindCriticRubric> {
    const rubric: BlindCriticRubric = {
      goalScore: 0.97,
      contractScore: 0.96,
      barScore: 0.98,
      contractVerdict: "PASS",
      barVerdict: "PASS",
      quotedDefects: [],
      reviewRound: (this.mockSquadTopology.members.find((m) => m.id === childId)?.reviewRounds ?? 0) + 1,
      criticRole: "critic_text",
      timestamp: new Date().toISOString(),
    };
    this.mockSquadTopology.members = this.mockSquadTopology.members.map((m) =>
      m.id === childId ? { ...m, reviewRounds: (m.reviewRounds ?? 0) + 1, latestRubric: rubric } : m,
    );
    return rubric;
  }

  // -------------------------------------------------------------------------
  // MCP Standard Subsystem Mock (Anthropic MCP v1.2+)
  // -------------------------------------------------------------------------

  private mockMcpServers: McpServerDetails[] = [
    {
      name: "filesystem",
      command: "npx",
      args: [
        "-y",
        "@modelcontextprotocol/server-filesystem",
        "C:\\Users\\Cayleb\\Desktop\\workspace\\sophos",
      ],
      enabled: true,
      status: "connected",
      latencyMs: 14,
      protocolVersion: "2024-11-05",
      capabilities: { tools: true, resources: true, prompts: true, logging: true },
      tools: [
        {
          name: "read_file",
          description: "Read the entire contents of a file from the filesystem",
          inputSchema: {
            type: "object",
            properties: { path: { type: "string", description: "Path to file" } },
            required: ["path"],
          },
        },
        {
          name: "write_file",
          description: "Write content to a file at the specified path",
          inputSchema: {
            type: "object",
            properties: {
              path: { type: "string", description: "Path to file" },
              content: { type: "string", description: "File content to write" },
            },
            required: ["path", "content"],
          },
        },
        {
          name: "list_directory",
          description: "List directory contents with metadata",
          inputSchema: {
            type: "object",
            properties: { path: { type: "string", description: "Directory path" } },
            required: ["path"],
          },
        },
      ],
      resources: [
        {
          uri: "file:///workspace/README.md",
          name: "Project README",
          description: "Main workspace architectural overview and build instructions",
          mimeType: "text/markdown",
          size: 16449,
          text: "# Sophos\nWindows-native coding agent desktop application.",
        },
        {
          uri: "file:///workspace/package.json",
          name: "Node Package Manifest",
          description: "Dependencies and workspace scripts definition",
          mimeType: "application/json",
          size: 2588,
          text: JSON.stringify({ name: "sophos", version: "0.9.0", private: true }, null, 2),
        },
        {
          uri: "file:///workspace/src-tauri/tauri.conf.json",
          name: "Tauri Desktop Config",
          description: "Tauri v2 application window and security settings",
          mimeType: "application/json",
          size: 1648,
          text: JSON.stringify({ productName: "Sophos", version: "0.9.0" }, null, 2),
        },
      ],
      prompts: [
        {
          name: "code_review",
          description: "Perform an in-depth blind code review for security, performance, and correctness",
          arguments: [
            { name: "filePath", description: "Target file path to review", required: true },
            {
              name: "focus",
              description: "Special focus (e.g. security, memory, typescript)",
              required: false,
            },
          ],
        },
        {
          name: "summarize_diff",
          description: "Generate a conventional commits summary from a git diff",
          arguments: [{ name: "diffText", description: "Unified diff text", required: true }],
        },
      ],
    },
    {
      name: "github",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-github"],
      enabled: true,
      status: "connected",
      latencyMs: 38,
      protocolVersion: "2024-11-05",
      capabilities: { tools: true, resources: true, prompts: false, logging: true },
      tools: [
        {
          name: "create_pull_request",
          description: "Create a new pull request on GitHub/GitLab",
          inputSchema: {
            type: "object",
            properties: {
              title: { type: "string" },
              body: { type: "string" },
              head: { type: "string" },
              base: { type: "string" },
            },
            required: ["title", "head", "base"],
          },
        },
        {
          name: "list_issues",
          description: "List recent issues from the repository",
          inputSchema: {
            type: "object",
            properties: { state: { type: "string", enum: ["open", "closed", "all"] } },
          },
        },
      ],
      resources: [
        {
          uri: "github://repo/caylebalvarez-james/sophos/issues",
          name: "Active Issue Tracker",
          description: "Live issue feed from GitLab / GitHub",
          mimeType: "application/json",
          size: 4096,
          text: JSON.stringify(
            [
              { id: 104, title: "Modernize MCP Explorer and Resource Streaming", status: "in_progress" },
              { id: 105, title: "SWE-agent Workspace Security Sandbox", status: "completed" },
            ],
            null,
            2,
          ),
        },
      ],
      prompts: [],
    },
  ];

  async getMcpServers(): Promise<McpServerDetails[]> {
    return this.mockMcpServers;
  }

  async readMcpResource(serverName: string, uri: string): Promise<McpResource> {
    const server = this.mockMcpServers.find((s) => s.name === serverName);
    const res = server?.resources.find((r) => r.uri === uri);
    if (!res) {
      throw new Error(`MCP Resource not found: ${uri} on server ${serverName}`);
    }
    return res;
  }

  async getMcpPrompt(
    serverName: string,
    name: string,
    args?: Record<string, string>,
  ): Promise<{ description?: string; messages: Array<{ role: "user" | "assistant"; content: string }> }> {
    const server = this.mockMcpServers.find((s) => s.name === serverName);
    const prompt = server?.prompts.find((p) => p.name === name);
    if (!prompt) {
      throw new Error(`MCP Prompt template not found: ${name} on server ${serverName}`);
    }
    const injectedArgs = args
      ? Object.entries(args)
          .map(([k, v]) => `${k}: ${v}`)
          .join("\n")
      : "none";
    return {
      description: prompt.description,
      messages: [
        {
          role: "user",
          content: `Execute MCP Prompt Template [${name}] from server [${serverName}].\nParameters:\n${injectedArgs}`,
        },
      ],
    };
  }

  // -------------------------------------------------------------------------
  // Workspace Security Sandbox Mock (SWE-agent Governance)
  // -------------------------------------------------------------------------

  private mockSecurityPolicy: WorkspaceSecurityPolicy = "confirm-risky";
  private mockCustomBlockedPatterns: string[] = [
    ".git/**",
    "**/.env*",
    "**/.ssh/**",
    "**/credentials.json",
    "**/id_rsa*",
  ];

  private mockSecurityAuditLog: SecurityAuditEntry[] = [
    {
      id: "sec-001",
      timestamp: new Date(Date.now() - 3600000).toISOString(),
      command: "git status",
      policy: "confirm-risky",
      blastRadius: {
        filesTargeted: 0,
        forbiddenPathsHit: [],
        riskLevel: "low",
        requiresConfirmation: false,
        reasons: ["Read-only git command"],
        suggestedAction: "Execute immediately",
      },
      status: "auto-passed",
      actor: "assistant",
    },
    {
      id: "sec-002",
      timestamp: new Date(Date.now() - 1800000).toISOString(),
      command: "rm -rf .git/hooks",
      policy: "confirm-risky",
      blastRadius: {
        filesTargeted: 1,
        forbiddenPathsHit: [".git/**"],
        riskLevel: "critical",
        requiresConfirmation: true,
        reasons: ["Attempts modification of forbidden git internal path: .git/**"],
        suggestedAction: "Block destructive operation",
      },
      status: "blocked",
      actor: "assistant",
    },
  ];

  async getSecurityPolicy(): Promise<{ policy: WorkspaceSecurityPolicy; customBlockedPatterns: string[] }> {
    return {
      policy: this.mockSecurityPolicy,
      customBlockedPatterns: this.mockCustomBlockedPatterns,
    };
  }

  async setSecurityPolicy(policy: WorkspaceSecurityPolicy, customBlockedPatterns?: string[]): Promise<void> {
    this.mockSecurityPolicy = policy;
    if (customBlockedPatterns) {
      this.mockCustomBlockedPatterns = customBlockedPatterns;
    }
  }

  async analyzeBlastRadius(command: string, targetFiles?: string[]): Promise<BlastRadiusReport> {
    const files = targetFiles ?? [];
    const forbiddenHits: string[] = [];
    const reasons: string[] = [];

    // Check command string and targets for forbidden path hits
    const normalized = (command + " " + files.join(" ")).toLowerCase();
    for (const pattern of this.mockCustomBlockedPatterns) {
      const cleanPattern = pattern.replace(/\*+/g, "").replace(/^\/|\/$/g, "");
      if (cleanPattern && normalized.includes(cleanPattern.toLowerCase())) {
        forbiddenHits.push(pattern);
        reasons.push(`Target touches guarded security zone: ${pattern}`);
      }
    }

    let riskLevel: "low" | "medium" | "high" | "critical" = "low";
    if (forbiddenHits.length > 0) {
      riskLevel = "critical";
    } else if (files.length > 10 || /npm (publish|i -g)|rm -rf|drop table/i.test(command)) {
      riskLevel = "high";
      reasons.push("Command touches large file count or high-impact system state");
    } else if (files.length > 3 || /package(-lock)?\.json|Cargo\.(toml|lock)/i.test(command)) {
      riskLevel = "medium";
      reasons.push("Modifies core package manifests or multiple files");
    } else {
      reasons.push("Standard bounded workspace operation");
    }

    const requiresConfirmation =
      this.mockSecurityPolicy === "strict-sandbox" ||
      (this.mockSecurityPolicy === "confirm-risky" && (riskLevel === "high" || riskLevel === "critical"));

    const report: BlastRadiusReport = {
      filesTargeted: files.length,
      forbiddenPathsHit: forbiddenHits,
      riskLevel,
      requiresConfirmation,
      reasons,
      suggestedAction: requiresConfirmation
        ? "Require explicit operator confirmation before execution"
        : "Safe to proceed under current security policy",
    };

    // Log to audit log
    this.mockSecurityAuditLog.unshift({
      id: `sec-${Date.now()}`,
      timestamp: new Date().toISOString(),
      command: command || "File modification",
      policy: this.mockSecurityPolicy,
      blastRadius: report,
      status: forbiddenHits.length > 0 ? "blocked" : requiresConfirmation ? "approved" : "auto-passed",
      actor: "assistant",
    });

    return report;
  }

  async getSecurityAuditLog(): Promise<SecurityAuditEntry[]> {
    return this.mockSecurityAuditLog;
  }

  // -------------------------------------------------------------------------
  // Dynamic Squad Workflow Engine Mock (LangGraph / AutoGen 0.4)
  // -------------------------------------------------------------------------

  private mockSquadWorkflow: SquadWorkflowState = {
    id: "wf-main",
    name: "Gauntlet Multi-Agent Synthesis Pipeline",
    type: "sequential",
    nodes: [
      {
        id: "node-planner",
        role: "Lead Architect",
        profileId: "gauntlet",
        model: "deepseek-v4-flash",
        status: "completed",
        contract: "Phase 0: Foundation First & bar.md Specification",
        outputPreview: "Established 5 non-negotiables, 6 acceptance checks, and 0.9.0 release targets.",
        latencyMs: 420,
        round: 1,
      },
      {
        id: "node-coder",
        role: "Gauntlet Worker (Implementer)",
        profileId: "code",
        model: "deepseek-v4-flash",
        status: "running",
        contract: "Phase 1: Code Intelligence & MCP Subsystem Expansion",
        outputPreview: "Implementing McpExplorer, SecuritySandboxPanel, and TokenBudget optimizer.",
        latencyMs: 1250,
        round: 1,
      },
      {
        id: "node-critic",
        role: "Blind Text Critic",
        profileId: "minimal",
        model: "deepseek-v4-flash",
        status: "idle",
        contract: "Phase 4: Independent External Rubric & Defect Scoring",
        round: 1,
      },
      {
        id: "node-verifier",
        role: "Lead End-State Verifier",
        profileId: "standard",
        model: "deepseek-v4-flash",
        status: "idle",
        contract: "Phase 5: 100% Vitest, TSC, Lint, Format, and Cargo Pass Gate",
        round: 1,
      },
    ],
    activeNodeId: "node-coder",
    consensusScore: 0.98,
    totalRounds: 1,
    maxRounds: 3,
    barVerdict: "PASS",
  };

  async getSquadWorkflow(): Promise<SquadWorkflowState> {
    return this.mockSquadWorkflow;
  }

  async runSquadWorkflow(type: SquadWorkflowType, goal: string, bar: string): Promise<SquadWorkflowState> {
    this.mockSquadWorkflow.type = type;
    this.mockSquadWorkflow.name = `${type.toUpperCase()} Squad Workflow: ${goal.slice(0, 30)}...`;
    this.mockSquadWorkflow.nodes = this.mockSquadWorkflow.nodes.map((n, i) => ({
      ...n,
      status: i === 0 ? "completed" : i === 1 ? "running" : "idle",
      contract: `Execute ${n.role} against bar: ${bar.slice(0, 25)}...`,
    }));
    this.mockSquadWorkflow.activeNodeId = "node-coder";
    return this.mockSquadWorkflow;
  }

  async pauseSquadWorkflow(_id: string): Promise<void> {
    if (this.mockSquadWorkflow.activeNodeId) {
      const active = this.mockSquadWorkflow.nodes.find((n) => n.id === this.mockSquadWorkflow.activeNodeId);
      if (active) active.status = "idle";
    }
  }

  // -------------------------------------------------------------------------
  // Token Budget & Context Optimizer Mock (DSPy / MemGPT)
  // -------------------------------------------------------------------------

  private mockTokenBudget: TokenBudgetBreakdown = {
    totalTokens: 31200,
    contextLimit: 128000,
    usagePercent: 24.38,
    tiers: {
      systemPrompt: 2400,
      toolsAndSchemas: 4200,
      workingMemory: 3800,
      episodicRecall: 2200,
      semanticArchival: 1500,
      chatHistory: 16000,
      checkpoints: 1100,
    },
    autoCompactionThreshold: 90000,
    compactionSavingsTokens: 0,
  };

  async getTokenBudget(): Promise<TokenBudgetBreakdown> {
    return this.mockTokenBudget;
  }

  async compactContext(
    strategy: "semantic-summarize" | "prune-oldest" | "evict-tools",
  ): Promise<{ beforeTokens: number; afterTokens: number; savedTokens: number }> {
    const before = this.mockTokenBudget.totalTokens;
    let saved = 0;
    if (strategy === "semantic-summarize") {
      saved = 8500;
      this.mockTokenBudget.tiers.chatHistory = Math.max(2000, this.mockTokenBudget.tiers.chatHistory - 8500);
    } else if (strategy === "prune-oldest") {
      saved = 6000;
      this.mockTokenBudget.tiers.chatHistory = Math.max(2000, this.mockTokenBudget.tiers.chatHistory - 6000);
    } else {
      saved = 2500;
      this.mockTokenBudget.tiers.toolsAndSchemas = Math.max(
        1500,
        this.mockTokenBudget.tiers.toolsAndSchemas - 2500,
      );
    }

    this.mockTokenBudget.totalTokens = Math.max(5000, before - saved);
    this.mockTokenBudget.usagePercent = Number(
      ((this.mockTokenBudget.totalTokens / this.mockTokenBudget.contextLimit) * 100).toFixed(2),
    );
    this.mockTokenBudget.compactionSavingsTokens =
      (this.mockTokenBudget.compactionSavingsTokens ?? 0) + saved;

    return {
      beforeTokens: before,
      afterTokens: this.mockTokenBudget.totalTokens,
      savedTokens: saved,
    };
  }

  // -------------------------------------------------------------------------
  // Native Windows Computer-Use Action Space Mock (CUA & UIA)
  // -------------------------------------------------------------------------

  private mockWindows: DesktopWindowInfo[] = [
    {
      id: "win-sophos",
      title: "Sophos — Desktop AI Coding Harness",
      processName: "sophos.exe",
      pid: 4820,
      bounds: { x: 120, y: 80, width: 1280, height: 820 },
      isMinimized: false,
      isVisible: true,
    },
    {
      id: "win-vscode",
      title: "Visual Studio Code — sophos [WSL: Ubuntu]",
      processName: "code.exe",
      pid: 8940,
      bounds: { x: 40, y: 40, width: 1440, height: 920 },
      isMinimized: false,
      isVisible: true,
    },
    {
      id: "win-browser",
      title: "Anthropic MCP v1.2 Documentation — Google Chrome",
      processName: "chrome.exe",
      pid: 11200,
      bounds: { x: 180, y: 120, width: 1160, height: 780 },
      isMinimized: false,
      isVisible: true,
    },
  ];

  async listDesktopWindows(): Promise<DesktopWindowInfo[]> {
    return this.mockWindows;
  }

  async inspectDesktopWindow(windowId: string): Promise<DesktopUiElement> {
    const win = this.mockWindows.find((w) => w.id === windowId) ?? this.mockWindows[0];
    return {
      id: `root-${win.id}`,
      name: win.title,
      role: "window",
      bounds: win.bounds,
      isEnabled: true,
      isFocused: true,
      children: [
        {
          id: `titlebar-${win.id}`,
          name: "TitleBar",
          role: "titlebar",
          bounds: { x: win.bounds.x, y: win.bounds.y, width: win.bounds.width, height: 32 },
          isEnabled: true,
          isFocused: false,
          children: [
            {
              id: "btn-minimize",
              name: "Minimize",
              role: "button",
              bounds: { x: win.bounds.x + win.bounds.width - 90, y: win.bounds.y, width: 30, height: 32 },
              isEnabled: true,
              isFocused: false,
            },
            {
              id: "btn-maximize",
              name: "Maximize",
              role: "button",
              bounds: { x: win.bounds.x + win.bounds.width - 60, y: win.bounds.y, width: 30, height: 32 },
              isEnabled: true,
              isFocused: false,
            },
            {
              id: "btn-close",
              name: "Close",
              role: "button",
              bounds: { x: win.bounds.x + win.bounds.width - 30, y: win.bounds.y, width: 30, height: 32 },
              isEnabled: true,
              isFocused: false,
            },
          ],
        },
        {
          id: `content-${win.id}`,
          name: "Main Client Area",
          role: "pane",
          bounds: {
            x: win.bounds.x,
            y: win.bounds.y + 32,
            width: win.bounds.width,
            height: win.bounds.height - 32,
          },
          isEnabled: true,
          isFocused: true,
          children: [
            {
              id: "elem-nav-sidebar",
              name: "Navigation Sidebar",
              role: "navigation",
              bounds: { x: win.bounds.x, y: win.bounds.y + 32, width: 220, height: win.bounds.height - 32 },
              isEnabled: true,
              isFocused: false,
            },
            {
              id: "elem-search-input",
              name: "Command Palette / Search",
              role: "edit",
              bounds: { x: win.bounds.x + 240, y: win.bounds.y + 48, width: 400, height: 36 },
              isEnabled: true,
              isFocused: false,
            },
            {
              id: "elem-action-btn",
              name: "Run Test Suite",
              role: "button",
              bounds: { x: win.bounds.x + 660, y: win.bounds.y + 48, width: 140, height: 36 },
              isEnabled: true,
              isFocused: false,
            },
            {
              id: "elem-editor-viewport",
              name: "Code Editor Viewport",
              role: "document",
              bounds: {
                x: win.bounds.x + 240,
                y: win.bounds.y + 100,
                width: win.bounds.width - 260,
                height: win.bounds.height - 120,
              },
              isEnabled: true,
              isFocused: true,
            },
          ],
        },
      ],
    };
  }

  async dispatchDesktopAction(windowId: string, action: DesktopUiAction): Promise<DesktopActionResult> {
    const win = this.mockWindows.find((w) => w.id === windowId) ?? this.mockWindows[0];
    const actionDesc =
      action.kind === "click"
        ? `Clicked at (${action.x ?? 100}, ${action.y ?? 100})`
        : action.kind === "type"
          ? `Typed "${action.text ?? ""}"`
          : action.kind === "keypress"
            ? `Pressed key [${action.key ?? "Enter"}]`
            : `Hovered element`;

    return {
      success: true,
      durationMs: 38,
      message: `Successfully executed ${action.kind} on "${win.title}": ${actionDesc}`,
      screenshot: `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400" fill="%231a1a1a"><rect width="100%" height="100%" fill="%23121212"/><text x="20" y="40" fill="%2310b981" font-family="monospace">Action: ${action.kind} on ${win.processName}</text></svg>`,
    };
  }

  async captureDesktopScreenshot(windowId: string): Promise<string> {
    const win = this.mockWindows.find((w) => w.id === windowId) ?? this.mockWindows[0];
    return `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="640" height="400" viewBox="0 0 640 400"><rect width="100%" height="100%" fill="%230f141c"/><rect x="10" y="10" width="620" height="32" fill="%231a2332" rx="4"/><circle cx="28" cy="26" r="5" fill="%23ef4444"/><circle cx="44" cy="26" r="5" fill="%23f59e0b"/><circle cx="60" cy="26" r="5" fill="%2310b981"/><text x="80" y="30" fill="%2394a3b8" font-size="12" font-family="sans-serif">${win.title}</text><rect x="10" y="50" width="160" height="340" fill="%23161f2e" rx="4"/><rect x="180" y="50" width="450" height="340" fill="%23131b28" rx="4"/><text x="200" y="80" fill="%2310b981" font-family="monospace" font-size="12">[UIA Scanner Active]</text><text x="200" y="110" fill="%23e2e8f0" font-family="monospace" font-size="14">${win.processName} (PID: ${win.pid})</text></svg>`;
  }

  // -------------------------------------------------------------------------
  // Self-Evolving Skill Distillation Mock (Voyager & Eureka)
  // -------------------------------------------------------------------------

  private mockDistilledSkills: DistilledSkill[] = [
    {
      id: "skill-act-remediator",
      name: "vitest-async-act-remediator",
      description: "Auto-detects and wraps async testing-library state transitions in Vitest suites",
      triggers: ["act() warning", "state update not wrapped in act", "vitest react 19 async"],
      skillMarkdown:
        "# Vitest Async Act Remediator\n\nAutomatically identifies React 19 testing-library state update warnings and applies deterministic waitFor wraps.",
      successRate: 0.96,
      runsObserved: 14,
      createdAt: "2026-08-28T09:40:00Z",
      isPromoted: true,
      sourceSessionId: "session-fix-mcp-tests",
    },
    {
      id: "skill-ipc-sync",
      name: "tauri-ipc-schema-synchronizer",
      description: "Bidirectionally syncs Rust Tauri command descriptors with TypeScript contract interfaces",
      triggers: ["tauri command mismatch", "invoke schema error", "IPC contract out of sync"],
      skillMarkdown:
        "# Tauri IPC Schema Synchronizer\n\nAnalyzes Rust #[tauri::command] signatures and generates TypeScript client method bindings with zero runtime overhead.",
      successRate: 0.92,
      runsObserved: 8,
      createdAt: "2026-08-28T10:15:00Z",
      isPromoted: false,
      sourceSessionId: "session-add-cua-commands",
    },
  ];

  async listDistilledSkills(): Promise<DistilledSkill[]> {
    return this.mockDistilledSkills;
  }

  async distillSkillFromTrajectory(sessionId: string, name?: string): Promise<DistilledSkill> {
    const skillName = name ?? `distilled-skill-${Date.now().toString(36)}`;
    const newSkill: DistilledSkill = {
      id: `skill-${Date.now().toString(36)}`,
      name: skillName,
      description: `Autonomously distilled workflow from session ${sessionId}`,
      triggers: [`trigger-${skillName}`, `session-${sessionId}`],
      skillMarkdown: `# ${skillName}\n\nAutonomously distilled by Voyager Experience Engine from trajectory \`${sessionId}\`.\n\n## Verified Steps\n1. Inspect AST\n2. Run targeted test\n3. Apply verified patch\n`,
      successRate: 1.0,
      runsObserved: 1,
      createdAt: new Date().toISOString(),
      isPromoted: false,
      sourceSessionId: sessionId,
    };
    this.mockDistilledSkills.unshift(newSkill);
    return newSkill;
  }

  async promoteSkill(skillId: string): Promise<{ success: boolean; targetPath: string }> {
    const target = this.mockDistilledSkills.find((s) => s.id === skillId);
    if (target) {
      target.isPromoted = true;
    }
    return {
      success: true,
      targetPath: `C:\\Users\\Cayleb\\.skill-library\\active\\${target?.name ?? "distilled-skill"}`,
    };
  }

  async deleteDistilledSkill(skillId: string): Promise<void> {
    this.mockDistilledSkills = this.mockDistilledSkills.filter((s) => s.id !== skillId);
  }

  // -------------------------------------------------------------------------
  // Speculative Tree-of-Thoughts Mock (ToT / FoT)
  // -------------------------------------------------------------------------

  private mockThoughtTree: ThoughtTreeState = {
    id: "tree-refactor-sandbox",
    rootId: "node-root",
    goal: "Isolate spec execution in ephemeral worktrees with automated rollback",
    nodes: [
      {
        id: "node-root",
        type: "hypothesis",
        label: "Hypothesis: Zero-copy Git worktrees vs Container sandbox",
        score: 0.88,
        status: "active",
        depth: 0,
        childrenIds: ["node-b1", "node-b2"],
        rationale: "Evaluating resource overhead on GMKtec EVO-X2 architecture",
      },
      {
        id: "node-b1",
        parentId: "node-root",
        type: "plan",
        label: "Branch A: Native Git zero-copy worktree pool",
        score: 0.94,
        status: "active",
        depth: 1,
        childrenIds: ["node-b1-diff"],
        rationale: "Instant spin-up (<50ms), shares local object database without RAM bloat",
      },
      {
        id: "node-b1-diff",
        parentId: "node-b1",
        type: "code_diff",
        label: "Code Diff: src-tauri/src/worktree.rs",
        score: 0.96,
        status: "promoted",
        depth: 2,
        diffSnippet:
          "+ pub fn create_worktree(repo: &Repository, branch: &str) -> Result<PathBuf> {\n+     let target = repo.worktree_add(branch, &path)?;\n+     Ok(target)\n+ }",
        rationale: "All 25 unit tests pass; verified clean teardown",
      },
      {
        id: "node-b2",
        parentId: "node-root",
        type: "plan",
        label: "Branch B: Docker containerized sandbox runner",
        score: 0.58,
        status: "pruned",
        depth: 1,
        rationale: "High cold-start latency (>4.5s) and violates background headless focus rule",
      },
    ],
    activeBranchPath: ["node-root", "node-b1", "node-b1-diff"],
    bestNodeId: "node-b1-diff",
  };

  async getThoughtTree(): Promise<ThoughtTreeState> {
    return this.mockThoughtTree;
  }

  async runSpeculativeBranch(parentNodeId: string, hypothesis: string): Promise<ThoughtTreeState> {
    const parent = this.mockThoughtTree.nodes.find((n) => n.id === parentNodeId);
    const newNodeId = `node-spec-${Date.now().toString(36)}`;
    const newNode: ThoughtNode = {
      id: newNodeId,
      parentId: parentNodeId,
      type: "plan",
      label: hypothesis,
      score: 0.91,
      status: "active",
      depth: (parent?.depth ?? 0) + 1,
      rationale: "Speculative candidate generated by local model brain",
      childrenIds: [],
    };
    if (parent) {
      parent.childrenIds = [...(parent.childrenIds ?? []), newNodeId];
    }
    this.mockThoughtTree.nodes.push(newNode);
    this.mockThoughtTree.activeBranchPath = [...this.mockThoughtTree.activeBranchPath, newNodeId];
    return this.mockThoughtTree;
  }

  async pruneThoughtBranch(nodeId: string): Promise<ThoughtTreeState> {
    const markPruned = (id: string) => {
      const node = this.mockThoughtTree.nodes.find((n) => n.id === id);
      if (node) {
        node.status = "pruned";
        node.childrenIds?.forEach(markPruned);
      }
    };
    markPruned(nodeId);
    return this.mockThoughtTree;
  }

  async promoteThoughtBranch(nodeId: string): Promise<ThoughtTreeState> {
    const node = this.mockThoughtTree.nodes.find((n) => n.id === nodeId);
    if (node) {
      node.status = "promoted";
      this.mockThoughtTree.bestNodeId = nodeId;
    }
    return this.mockThoughtTree;
  }

  // -------------------------------------------------------------------------
  // Ephemeral Workspace Twin Sandbox Mock (Devin Sandbox / Worktrees)
  // -------------------------------------------------------------------------

  private mockTwins: WorkspaceTwin[] = [
    {
      id: "twin-refactor-security",
      name: "twin-refactor-security",
      branch: "twin/refactor-security-interlocks",
      worktreePath: "C:\\Users\\Cayleb\\Desktop\\workspace\\.twins\\twin-refactor-security",
      status: "clean",
      modifiedFilesCount: 4,
      createdAt: "2026-08-28T11:00:00Z",
      lastActiveAt: "2026-08-28T11:45:00Z",
      baseCommit: "d9e02f7",
    },
    {
      id: "twin-vitest-migration",
      name: "twin-vitest-migration",
      branch: "twin/vitest-async-act-remediation",
      worktreePath: "C:\\Users\\Cayleb\\Desktop\\workspace\\.twins\\twin-vitest-migration",
      status: "dirty",
      modifiedFilesCount: 2,
      createdAt: "2026-08-28T11:20:00Z",
      lastActiveAt: "2026-08-28T11:50:00Z",
      baseCommit: "d9e02f7",
    },
  ];

  async listWorkspaceTwins(): Promise<WorkspaceTwin[]> {
    return this.mockTwins;
  }

  async createWorkspaceTwin(name: string, baseBranch?: string): Promise<WorkspaceTwin> {
    const cleanName = name.toLowerCase().replace(/[^a-z0-9_-]/g, "-");
    const newTwin: WorkspaceTwin = {
      id: `twin-${cleanName}-${Date.now().toString(36)}`,
      name: cleanName,
      branch: `twin/${cleanName}`,
      worktreePath: `C:\\Users\\Cayleb\\Desktop\\workspace\\.twins\\twin-${cleanName}`,
      status: "clean",
      modifiedFilesCount: 0,
      createdAt: new Date().toISOString(),
      lastActiveAt: new Date().toISOString(),
      baseCommit: baseBranch ?? "HEAD",
    };
    this.mockTwins.unshift(newTwin);
    return newTwin;
  }

  async executeInTwin(twinId: string, command: string): Promise<TwinExecResult> {
    const target = this.mockTwins.find((t) => t.id === twinId);
    if (target) {
      target.status = "dirty";
      target.modifiedFilesCount += 1;
      target.lastActiveAt = new Date().toISOString();
    }
    return {
      twinId,
      command,
      exitCode: 0,
      stdout: `[TWIN WORKTREE ISOLATION] Successfully executed "${command}" inside ephemeral branch\nAll 25 unit tests passed. No files in primary workspace were mutated.`,
      stderr: "",
      durationMs: 64,
    };
  }

  async diffWorkspaceTwin(twinId: string): Promise<TwinDiffReport> {
    const target = this.mockTwins.find((t) => t.id === twinId);
    return {
      twinId,
      filesChanged: [
        "src/features/security/SecuritySandboxPanel.tsx",
        "src/ipc/contract.ts",
        "src-tauri/src/worktree.rs",
      ],
      insertions: 84,
      deletions: 12,
      diffText: `diff --git a/src-tauri/src/worktree.rs b/src-tauri/src/worktree.rs\n+ pub struct EphemeralWorktree {\n+     pub path: PathBuf,\n+     pub branch: String,\n+ }`,
      isMergeable: target?.status !== "rolled_back",
    };
  }

  async mergeWorkspaceTwin(twinId: string): Promise<{ success: boolean; mergedCommit: string }> {
    const target = this.mockTwins.find((t) => t.id === twinId);
    if (target) {
      target.status = "merged";
      target.lastActiveAt = new Date().toISOString();
    }
    return {
      success: true,
      mergedCommit: `merge-${Date.now().toString(36)}`,
    };
  }

  async rollbackWorkspaceTwin(twinId: string): Promise<{ success: boolean; message: string }> {
    const target = this.mockTwins.find((t) => t.id === twinId);
    if (target) {
      target.status = "rolled_back";
    }
    return {
      success: true,
      message: `Pruned zero-copy worktree and deleted branch cleanly. Zero residue.`,
    };
  }
}
