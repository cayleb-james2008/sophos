// IPC client — the typed bridge between the React frontend and the Rust Tauri
// main process (which forwards to the Node bridge sidecar -> daemon).
//
// P3 owns the full implementation. This is a working, typed client with a
// graceful browser fallback so the app builds and runs even before Tauri is
// wired. P4/P5 consume this API surface — do not break it.
//
// Also exports the React hooks `useIpc`, `useConnectionState`, and
// `useIpcEvent` for subscribing to the live event stream.

import { useEffect, useMemo, useRef, useState } from "react";
import type {
  AgentInfo,
  AgentMessage,
  AgentMessageReceipt,
  ConnectionState,
  AgentSessionState,
  ExtensionInfo,
  HarnessState,
  KernelState,
  ContextTreeNode,
  IpcEvent,
  LocalProviderConfig,
  McpTestResult,
  ModelInfo,
  ModelRuntimeConfig,
  NavigateTreeResult,
  ProviderInfo,
  RefinementResult,
  RuntimeInfo,
  RuntimeSkill,
  ScheduleInfo,
  SessionInfo,
  SessionTree,
  Settings,
  SlashCommand,
  TranscriptMessage,
} from "./contract";

/** True when running inside the Tauri shell (real IPC); false in the browser preview. */
export const isTauri =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export interface IpcClient {
  // Commands
  prompt(text: string, options?: { thinking?: string; streamingBehavior?: "steer" | "followUp"; queueIfBusy?: boolean }): Promise<void>;
  abort(): Promise<void>;
  steer(text: string): Promise<void>;
  setModel(provider: string, model: string, thinking?: string, runtime?: ModelRuntimeConfig, fastMode?: boolean): Promise<void>;
  newSession(cwd?: string, goal?: string): Promise<void>;
  switchSession(id: string): Promise<void>;
  resumeSession(pathOrId: string): Promise<void>;
  forkSession(pathOrId: string): Promise<void>;
  listSessions(): Promise<SessionInfo[]>;
  listAgents(): Promise<AgentInfo[]>;
  attachAgent(id: string): Promise<{ childId: string; sessionId: string; attached: true }>;
  detachAgent(id: string): Promise<void>;
  getState(): Promise<ConnectionState>;
  getTranscript(): Promise<TranscriptMessage[]>;
  getModels(): Promise<ModelInfo[]>;
  getProviders(): Promise<ProviderInfo[]>;
  login(provider: string, apiKey?: string): Promise<void>;
  logout(provider: string): Promise<void>;
  getSettings(): Promise<Settings>;
  setSettings(settings: Settings): Promise<void>;
  runCommand(command: string, args?: string[]): Promise<void>;
  getContextStats(): Promise<ConnectionState["context"]>;
  getRlmChildren(): Promise<ConnectionState["rlmChildren"]>;
  sendAgentMessage(agentId: string, message: string): Promise<AgentMessageReceipt>;
  listInbox(): Promise<AgentMessage[]>;
  markMessageRead(messageId: string): Promise<void>;
  compact(prompt?: string): Promise<void>;
  retry(): Promise<void>;
  refine(): Promise<void>;
  exportSession(format?: string): Promise<{ exportedPath?: string }>;
  shareSession(): Promise<void>;
  getSessionTree(): Promise<SessionTree>;
  cloneSession(): Promise<{ activeSessionId?: string }>;
  nameSession(name: string): Promise<void>;
  sideQuestion(text: string): Promise<{ id: string }>;
  addSchedule(cron: string, prompt: string): Promise<ScheduleInfo>;
  removeSchedule(id: string): Promise<ScheduleInfo>;
  setHeartbeat(schedule: string, prompt?: string): Promise<ScheduleInfo | undefined>;
  removeHeartbeat(): Promise<ScheduleInfo | undefined>;
  navigateTree(entryId: string): Promise<NavigateTreeResult>;
  startSideQuestion(text: string): Promise<{ id: string }>;
  exportToHtml(outputPath?: string): Promise<{ outputPath: string }>;
  exportToJsonl(outputPath?: string): Promise<{ outputPath: string }>;
  setSessionName(name: string): Promise<void>;
  getContextTree(): Promise<ContextTreeNode>;
  getRuntimeInfo(): Promise<RuntimeInfo>;
  getKernelState(): Promise<KernelState>;
  getHarnessState(): Promise<HarnessState>;
  getAgentState(id: string): Promise<AgentSessionState>;
  createSkill(input: { name: string; description: string; content: string; pythonImport?: string }): Promise<RuntimeSkill>;
  installSkill(path: string): Promise<RuntimeSkill[]>;
  installExtension(path: string): Promise<void>;
  removeExtension(path: string): Promise<void>;
  getExtensions(): Promise<ExtensionInfo[]>;
  testMcpServer(name: string, command: string, args?: string[]): Promise<McpTestResult>;
  getSlashCommands(): Promise<SlashCommand[]>;

  // Events
  onEvent(cb: (event: IpcEvent) => void): () => void;
}

// ---------------------------------------------------------------------------
// Tauri-backed implementation
// ---------------------------------------------------------------------------

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd, args);
}

let requestCounter = 0;

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class TauriIpcClient implements IpcClient {
  private eventListeners: Array<(event: IpcEvent) => void> = [];
  private eventUnlisten?: () => void;
  private pending = new Map<string, PendingRequest>();
  private responseUnlisten?: () => void;

  constructor() {
    // Set up the ipc-response listener for command response matching.
    this.setupResponseListener();
  }

  private async setupResponseListener(): Promise<void> {
    const { listen } = await import("@tauri-apps/api/event");
    this.responseUnlisten = await listen<{ id?: string; result?: unknown; error?: { message: string } }>("ipc-response", (e) => {
      const payload = e.payload;
      const id = payload?.id;
      if (!id) return;
      const pending = this.pending.get(id);
      if (!pending) return;
      clearTimeout(pending.timer);
      this.pending.delete(id);
      if (payload.error) {
        pending.reject(new Error(payload.error.message));
      } else {
        pending.resolve(payload.result);
      }
    });
  }

  private async ensureEventListener(): Promise<void> {
    if (this.eventUnlisten) return;
    const { listen } = await import("@tauri-apps/api/event");
    this.eventUnlisten = await listen<IpcEvent>("ipc-event", (e) => {
      for (const cb of this.eventListeners) {
        cb(e.payload);
      }
    });
  }

  /** Subscribe to the raw IPC event stream. */
  onEvent(cb: (event: IpcEvent) => void): () => void {
    this.eventListeners.push(cb);
    // Set up the Tauri event listener on first subscription.
    void this.ensureEventListener();
    return () => {
      this.eventListeners = this.eventListeners.filter((l) => l !== cb);
    };
  }

  /** Detach all listeners. */
  disconnect(): void {
    this.eventUnlisten?.();
    this.responseUnlisten?.();
    this.eventUnlisten = undefined;
    this.responseUnlisten = undefined;
    this.eventListeners = [];
  }

  private async send(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    const id = `req-${++requestCounter}`;
    const command = { id, method, params };
    // Fire-and-forget: the Rust shell writes to stdin and returns immediately.
    // The response comes back as an ipc-response Tauri event.
    void invoke("ipc_command", { command }).catch(() => {
      // If invoke fails (sidecar not running), reject the pending request.
      const pending = this.pending.get(id);
      if (pending) {
        clearTimeout(pending.timer);
        this.pending.delete(id);
        pending.reject(new Error("IPC command failed: sidecar not running"));
      }
    });
    // Return a promise that resolves when the matching ipc-response arrives.
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`IPC timeout: ${method} did not respond within 15s`));
      }, 15000);
      this.pending.set(id, { resolve, reject, timer });
    });
  }

  prompt(text: string, options?: { thinking?: string }): Promise<void> {
    return this.send("prompt", { text, options }) as Promise<void>;
  }
  abort(): Promise<void> {
    return this.send("abort", {}) as Promise<void>;
  }
  steer(text: string): Promise<void> {
    return this.send("steer", { text }) as Promise<void>;
  }
  setModel(provider: string, model: string, thinking?: string, runtime?: ModelRuntimeConfig, fastMode?: boolean): Promise<void> {
    return this.send("setModel", {
      provider,
      model,
      thinking,
      ...(runtime?.contextWindow != null ? { contextWindow: runtime.contextWindow } : {}),
      ...(runtime?.maxOutputTokens != null ? { maxOutputTokens: runtime.maxOutputTokens } : {}),
      ...(fastMode != null ? { fastMode } : {}),
    }) as Promise<void>;
  }
  newSession(cwd?: string, goal?: string): Promise<void> {
    return this.send("newSession", { cwd, goal }) as Promise<void>;
  }
  switchSession(id: string): Promise<void> {
    return this.send("switchSession", { id }) as Promise<void>;
  }
  resumeSession(pathOrId: string): Promise<void> {
    return this.send("resumeSession", { pathOrId }) as Promise<void>;
  }
  forkSession(pathOrId: string): Promise<void> {
    return this.send("forkSession", { pathOrId }) as Promise<void>;
  }
  listSessions(): Promise<SessionInfo[]> {
    return this.send("listSessions", {}) as Promise<SessionInfo[]>;
  }
  listAgents(): Promise<AgentInfo[]> {
    return this.send("listAgents", {}) as Promise<AgentInfo[]>;
  }
  attachAgent(id: string): Promise<{ childId: string; sessionId: string; attached: true }> {
    return this.send("attachAgent", { id }) as Promise<{ childId: string; sessionId: string; attached: true }>;
  }
  detachAgent(id: string): Promise<void> {
    return this.send("detachAgent", { id }) as Promise<void>;
  }
  getState(): Promise<ConnectionState> {
    return this.send("getState", {}) as Promise<ConnectionState>;
  }
  getTranscript(): Promise<TranscriptMessage[]> {
    return this.send("getTranscript", {}) as Promise<TranscriptMessage[]>;
  }
  getModels(): Promise<ModelInfo[]> {
    return this.send("getModels", {}) as Promise<ModelInfo[]>;
  }
  getProviders(): Promise<ProviderInfo[]> {
    return this.send("getProviders", {}) as Promise<ProviderInfo[]>;
  }
  login(provider: string, apiKey?: string): Promise<void> {
    return this.send("login", { provider, apiKey }) as Promise<void>;
  }
  logout(provider: string): Promise<void> {
    return this.send("logout", { provider }) as Promise<void>;
  }
  getSettings(): Promise<Settings> {
    return this.send("getSettings", {}) as Promise<Settings>;
  }
  setSettings(settings: Settings): Promise<void> {
    return this.send("setSettings", { settings }) as Promise<void>;
  }
  runCommand(command: string, args?: string[]): Promise<void> {
    return this.send("runCommand", { command, args }) as Promise<void>;
  }
  getContextStats(): Promise<ConnectionState["context"]> {
    return this.send("getContextStats", {}) as Promise<ConnectionState["context"]>;
  }
  getRlmChildren(): Promise<ConnectionState["rlmChildren"]> {
    return this.send("getRlmChildren", {}) as Promise<ConnectionState["rlmChildren"]>;
  }
  sendAgentMessage(agentId: string, message: string): Promise<AgentMessageReceipt> {
    return this.send("sendAgentMessage", { agentId, message }) as Promise<AgentMessageReceipt>;
  }
  listInbox(): Promise<AgentMessage[]> {
    return this.send("listInbox", {}) as Promise<AgentMessage[]>;
  }
  markMessageRead(messageId: string): Promise<void> {
    return this.send("markMessageRead", { messageId }) as Promise<void>;
  }
  compact(prompt?: string): Promise<void> {
    return this.send("compact", prompt ? { prompt } : {}) as Promise<void>;
  }
  retry(): Promise<void> {
    return this.send("retry", {}) as Promise<void>;
  }
  refine(): Promise<void> {
    return this.send("refine", {}) as Promise<void>;
  }
  exportSession(format?: string): Promise<{ exportedPath?: string }> {
    return this.send("exportSession", { format }) as Promise<{ exportedPath?: string }>;
  }
  shareSession(): Promise<void> {
    return this.send("shareSession", {}) as Promise<void>;
  }
  getSessionTree(): Promise<SessionTree> {
    return this.send("getSessionTree", {}) as Promise<SessionTree>;
  }
  cloneSession(): Promise<{ activeSessionId?: string }> {
    return this.send("cloneSession", {}) as Promise<{ activeSessionId?: string }>;
  }
  nameSession(name: string): Promise<void> {
    return this.send("nameSession", { name }) as Promise<void>;
  }
  sideQuestion(text: string): Promise<{ id: string }> {
    return this.send("sideQuestion", { text }) as Promise<{ id: string }>;
  }
  addSchedule(cron: string, prompt: string): Promise<ScheduleInfo> {
    return this.send("addSchedule", { cron, prompt }) as Promise<ScheduleInfo>;
  }
  removeSchedule(id: string): Promise<ScheduleInfo> {
    return this.send("removeSchedule", { id }) as Promise<ScheduleInfo>;
  }
  setHeartbeat(schedule: string, prompt?: string): Promise<ScheduleInfo | undefined> {
    return this.send("setHeartbeat", { schedule, prompt }) as Promise<ScheduleInfo | undefined>;
  }
  removeHeartbeat(): Promise<ScheduleInfo | undefined> {
    return this.send("removeHeartbeat", {}) as Promise<ScheduleInfo | undefined>;
  }
  navigateTree(entryId: string): Promise<NavigateTreeResult> {
    return this.send("navigateTree", { entryId }) as Promise<NavigateTreeResult>;
  }
  startSideQuestion(text: string): Promise<{ id: string }> {
    return this.send("startSideQuestion", { text }) as Promise<{ id: string }>;
  }
  exportToHtml(outputPath?: string): Promise<{ outputPath: string }> {
    return this.send("exportToHtml", { outputPath }) as Promise<{ outputPath: string }>;
  }
  exportToJsonl(outputPath?: string): Promise<{ outputPath: string }> {
    return this.send("exportToJsonl", { outputPath }) as Promise<{ outputPath: string }>;
  }
  setSessionName(name: string): Promise<void> {
    return this.send("setSessionName", { name }) as Promise<void>;
  }
  getContextTree(): Promise<ContextTreeNode> {
    return this.send("getContextTree", {}) as Promise<ContextTreeNode>;
  }
  getRuntimeInfo(): Promise<RuntimeInfo> {
    return this.send("getRuntimeInfo", {}) as Promise<RuntimeInfo>;
  }
  getKernelState(): Promise<KernelState> {
    return this.send("getKernelState", {}) as Promise<KernelState>;
  }
  getHarnessState(): Promise<HarnessState> {
    return this.send("getHarnessState", {}) as Promise<HarnessState>;
  }
  getAgentState(id: string): Promise<AgentSessionState> {
    return this.send("getAgentState", { id }) as Promise<AgentSessionState>;
  }
  createSkill(input: { name: string; description: string; content: string; pythonImport?: string }): Promise<RuntimeSkill> {
    return this.send("createSkill", input) as Promise<RuntimeSkill>;
  }
  installSkill(path: string): Promise<RuntimeSkill[]> {
    return this.send("installSkill", { path }) as Promise<RuntimeSkill[]>;
  }
  installExtension(path: string): Promise<void> {
    return this.send("installExtension", { path }) as Promise<void>;
  }
  removeExtension(path: string): Promise<void> {
    return this.send("removeExtension", { path }) as Promise<void>;
  }
  getExtensions(): Promise<ExtensionInfo[]> {
    return this.send("getExtensions", {}) as Promise<ExtensionInfo[]>;
  }
  testMcpServer(name: string, command: string, args?: string[]): Promise<McpTestResult> {
    return this.send("testMcpServer", { name, command, args }) as Promise<McpTestResult>;
  }
  getSlashCommands(): Promise<SlashCommand[]> {
    return this.send("getSlashCommands", {}) as Promise<SlashCommand[]>;
  }
}

// ---------------------------------------------------------------------------
// Browser fallback (dev without Tauri) — returns neutral data and simulates a
// connection lifecycle (connecting -> connected) so the shell's live status
// indicator is demonstrable in the browser preview.
// ---------------------------------------------------------------------------

const LOCAL_MODEL_CONFIG_KEY = "prime-agent.modelConfig.v1";
const LOCAL_PROVIDER_KEY = "prime-agent.localProviders.v1";
const LOCAL_SETTINGS_KEY = "prime-agent.settings.v1";

function readLocalSettings(): Settings {
  try {
    const raw = typeof window !== "undefined" ? window.localStorage.getItem(LOCAL_SETTINGS_KEY) : null;
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Settings : {};
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
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, ModelRuntimeConfig>) : {};
  } catch {
    return {};
  }
}

/** Persist the mock's model overrides to localStorage so a page reload keeps them. */
function writeLocalModelConfig(value: Record<string, ModelRuntimeConfig>): void {
  try {
    if (typeof window !== "undefined") window.localStorage.setItem(LOCAL_MODEL_CONFIG_KEY, JSON.stringify(value));
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
    return Array.isArray(parsed) ? (parsed as LocalProviderConfig[]) : null;
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
  private mockSettings: Settings = {
    ...INITIAL_LOCAL_SETTINGS,
    theme: INITIAL_LOCAL_SETTINGS.theme ?? "dark",
    modelConfig: { ...(INITIAL_LOCAL_SETTINGS.modelConfig ?? {}), ...readLocalModelConfig() },
    localProviders: readLocalProviders() ?? [LOCAL_DEFAULT_CONFIG],
  };
  private state: ConnectionState = {
    status: { kind: "connecting" },
    model: {
      provider: this.mockSettings.defaultProvider ?? "ollama-cloud",
      model: this.mockSettings.defaultModel ?? "deepseek-v4-flash:0731-cloud",
      thinking: this.mockSettings.defaultThinking,
    },
    activeSessionId: "session-0",
    goals: [{ id: "goal-demo", objective: "Ship the release and verify every published artifact", status: "active", progress: "3 of 5 artifacts verified" }],
    context: { tokens: 18432, contextWindow: 1000000, messages: 42 },
    rlmChildren: [{ id: "rlm-1", name: "api-reviewer", status: "running", parentId: "session-0", summary: "Reviewing endpoint contracts" }],
    schedules: [{ id: "sched-1", cron: "0 9 * * *", prompt: "Send the morning standup summary to the team channel", active: true }],
    heartbeats: [{ id: "hb-1", interval: "*/15 * * * *", active: true }],
    autonomousConfig: { active: false, maxTurns: 12, maxTokens: 80000, maxTime: "30m", qualityGates: ["npm run build", "npm test"] },
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

  /** Rich per-extension detail (registered tools + slash commands) surfaced by
   * getExtensions() so the Extensions panel can render them in the browser
   * preview without a live daemon. Kept consistent with mockExtensions so the
   * configured list, the live daemon paths, and the rich detail all line up. */
  private mockExtensionDetails: ExtensionInfo[] = [
    { name: "github-integration", path: "~/.pi/agent/extensions/github-integration", enabled: true, tools: [{ name: "create_issue", description: "Create a GitHub issue" }, { name: "list_prs", description: "List open pull requests" }], slashCommands: [{ name: "issue", description: "Create or view GitHub issues" }] },
    { name: "linear-sync", path: "~/.pi/agent/extensions/linear-sync", enabled: true, tools: [{ name: "create_task", description: "Create a Linear task" }], slashCommands: [{ name: "linear", description: "Manage Linear tasks" }] },
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

  async prompt(text: string): Promise<void> {
    this.emit({ type: "session_event", event: { kind: "user_message", text } });
  }
  async abort(): Promise<void> {}
  async steer(): Promise<void> {}
  async setModel(provider: string, model: string, _thinking?: string, runtime?: ModelRuntimeConfig, fastMode?: boolean): Promise<void> {
    if (runtime) {
      this.applyModelRuntime(provider, model, runtime);
    }
    this.mockSettings = {
      ...this.mockSettings,
      defaultProvider: provider,
      defaultModel: model,
      ...(_thinking ? { defaultThinking: _thinking } : {}),
      ...(fastMode != null ? { fastMode, defaultFastMode: fastMode } : {}),
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
      this.state = { ...this.state, context: { ...(this.state.context ?? {}), contextWindow: runtime.contextWindow } };
    }
    this.emit({ type: "snapshot", state: this.state });
  }
  async newSession(_cwd?: string, goal?: string): Promise<void> {
    const id = `session-${Date.now()}`;
    this.activeSessionId = id;
    this.state = { ...this.state, activeSessionId: id };
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
    const id = `session-${Date.now()}`;
    this.activeSessionId = id;
    this.state = { ...this.state, activeSessionId: id };
    this.emit({ type: "snapshot", state: this.state });
  }
  async listSessions(): Promise<SessionInfo[]> {
    return [
      { id: "session-0", title: "Refactor auth module", status: "active", cwd: "C:\\work\\api-service", createdAt: new Date(Date.now() - 3600000).toISOString(), updatedAt: new Date().toISOString() },
      { id: "session-1", title: "Migrate to new config schema", status: "saved", cwd: "C:\\work\\infra", createdAt: new Date(Date.now() - 86400000).toISOString(), updatedAt: new Date(Date.now() - 86400000).toISOString() },
      { id: "session-2", title: "Sophos — Windows", status: "idle", cwd: "C:\\work\\sophos", createdAt: new Date(Date.now() - 172800000).toISOString() },
    ];
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
    this.emit({ type: "agent_watch", event: { kind: "detached", childId: id, sessionId: id, reason: "detached" } });
  }
  async getState(): Promise<ConnectionState> {
    return {
      ...this.state,
      goals: this.state.goals ?? [
        { id: "goal-demo", objective: "Ship the release and verify every published artifact", status: "active" as const, progress: "3 of 5 artifacts verified" },
      ],
      context: { tokens: 18432, contextWindow: this.state.context?.contextWindow ?? 1000000, messages: 42 },
      rlmChildren: [
        { id: "rlm-1", name: "api-reviewer", status: "running" as const, parentId: this.state.activeSessionId, summary: "Reviewing endpoint contracts" },
      ],
      schedules: this.state.schedules ?? [{ id: "sched-1", cron: "0 9 * * *", prompt: "Send the morning standup summary to the team channel", active: true }],
      heartbeats: this.state.heartbeats ?? [{ id: "hb-1", interval: "*/15 * * * *", active: true }],
      autonomousConfig: this.state.autonomousConfig ?? { active: false, maxTurns: 12, maxTokens: 80000, maxTime: "30m", qualityGates: ["npm run build", "npm test"] },
      costStats: this.state.costStats ?? { totalCost: 0.84, inputTokens: 421337, outputTokens: 118204, sessionCost: 0.31 },
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
      supportsFast: true,
    },
    {
      id: "deepseek-v4-flash-free",
      name: "DeepSeek V4 Flash (free)",
      provider: "opencode",
      contextWindow: 1000000,
      maxOutputTokens: 65536,
      maxContextWindow: 1000000,
      maxOutputTokensCeiling: 65536,
      supportsFast: true,
    },
    {
      id: "MiniMax-M3",
      name: "MiniMax M3",
      provider: "minimax",
      contextWindow: 524288,
      maxOutputTokens: 128000,
      maxContextWindow: 524288,
      maxOutputTokensCeiling: 128000,
      supportsFast: false,
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
      { id: "ollama-cloud", name: "Ollama Cloud", kind: "api_key", connected: !this.mockLoggedOut.has("ollama-cloud"), models: [] },
      { id: "openrouter", name: "OpenRouter", kind: "api_key", connected: !this.mockLoggedOut.has("openrouter"), models: [] },
      { id: "minimax", name: "MiniMax", kind: "api_key", connected: !this.mockLoggedOut.has("minimax"), models: [] },
      { id: "opencode", name: "Codex (OpenCode)", kind: "api_key", connected: !this.mockLoggedOut.has("opencode"), models: [] },
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
    return { ...this.mockSettings, modelConfig: { ...(this.mockSettings.modelConfig ?? {}) }, extensions: this.mockExtensions } as unknown as Settings;
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
      compaction: { lastCompactedAt: undefined, reason: undefined },
    };
  }
  async getRlmChildren(): Promise<ConnectionState["rlmChildren"]> {
    return [
      { id: "rlm-1", name: "api-reviewer", status: "running" as const, parentId: this.activeSessionId, summary: "Reviewing endpoint contracts" },
      { id: "rlm-2", name: "test-runner", status: "idle" as const, parentId: this.activeSessionId, summary: "Awaiting next batch" },
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
    return [];
  }
  async markMessageRead(): Promise<void> {}
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
    const oldContent = [
      "You are Sophos, a focused agent.",
      "Complete the user's tasks.",
      "Be concise.",
    ].join("\n");
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
    return { exportedPath: format === "jsonl" ? "mock://session-export.jsonl" : "mock://session-export.html" };
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
            { id: "entry-2", type: "message", label: "Agent reply", timestamp: new Date(Date.now() - 3000000).toISOString(), parentId: "entry-1" },
          ],
        },
      ],
      leafId: "entry-2",
    };
  }
  async cloneSession(): Promise<{ activeSessionId?: string }> {
    const id = `session-${Date.now()}`;
    this.activeSessionId = id;
    this.state = { ...this.state, activeSessionId: id };
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
  async createSkill(input: { name: string; description: string; content: string; pythonImport?: string }): Promise<RuntimeSkill> {
    const skill: RuntimeSkill = { name: input.name, description: input.description, source: "browser-preview" };
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
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

let client: IpcClient | undefined;

export function getIpcClient(): IpcClient {
  if (client) return client;
  // In Tauri, the global __TAURI_INTERNALS__ is present.
  const inTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
  client = inTauri ? new TauriIpcClient() : new MockIpcClient();
  // Expose on window in browser/demo mode so the e2e test harness can patch
  // the singleton directly (Vite HMR creates separate module instances per
  // `?t=` timestamp, so `import()` in page.evaluate resolves to a different
  // module than the app loaded — patching that prototype has no effect on the
  // already-instantiated singleton). In Tauri this is a no-op (the mock isn't
  // used). Harmless in production.
  if (typeof window !== "undefined" && !inTauri) {
    (window as any).__sophosIpc = client;
  }
  return client;
}

// ---------------------------------------------------------------------------
// React hooks
// ---------------------------------------------------------------------------

/** Returns the singleton IPC client (stable across renders). */
export function useIpc(): IpcClient {
  return useMemo(() => getIpcClient(), []);
}

/** Subscribe to the raw IPC event stream. Returns the unsubscribe fn. */
export function useIpcEvent(cb: (event: IpcEvent) => void): void {
  const client = useIpc();
  const cbRef = useRef(cb);
  cbRef.current = cb;
  useEffect(() => {
    return client.onEvent((event) => cbRef.current(event));
  }, [client]);
}

/**
 * Live connection state. Initializes from getState() and stays in sync with
 * `connection_status`, `snapshot`, and `resynced` events.
 */
export function useConnectionState(): ConnectionState {
  const client = useIpc();
  const [state, setState] = useState<ConnectionState>({ status: { kind: "connecting" } });

  useEffect(() => {
    let mounted = true;
    client.getState().then((s) => {
      if (mounted && s) setState(s);
    }).catch(() => {
      // getState may fail if daemon is unreachable — keep "connecting" state.
    });
    return () => {
      mounted = false;
    };
  }, [client]);

  useIpcEvent((event) => {
    if (event.type === "connection_status") {
      setState((prev) => ({ ...prev, status: event.status }));
    } else if (event.type === "snapshot" || event.type === "resynced") {
      setState(event.state);
    }
  });

  return state;
}
