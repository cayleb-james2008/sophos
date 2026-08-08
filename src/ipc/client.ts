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
  ConnectionState,
  ContextTreeNode,
  IpcEvent,
  ModelInfo,
  ModelRuntimeConfig,
  NavigateTreeResult,
  ProviderInfo,
  ScheduleInfo,
  SessionInfo,
  SessionTree,
  Settings,
  TranscriptMessage,
} from "./contract";

/** True when running inside the Tauri shell (real IPC); false in the browser preview. */
export const isTauri =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export interface IpcClient {
  // Commands
  prompt(text: string, options?: { thinking?: string }): Promise<void>;
  abort(): Promise<void>;
  steer(text: string): Promise<void>;
  setModel(provider: string, model: string, thinking?: string, runtime?: ModelRuntimeConfig): Promise<void>;
  newSession(cwd?: string, goal?: string): Promise<void>;
  switchSession(id: string): Promise<void>;
  resumeSession(pathOrId: string): Promise<void>;
  forkSession(pathOrId: string): Promise<void>;
  listSessions(): Promise<SessionInfo[]>;
  listAgents(): Promise<AgentInfo[]>;
  attachAgent(id: string): Promise<void>;
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
  sendAgentMessage(agentId: string, message: string): Promise<void>;
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
  setModel(provider: string, model: string, thinking?: string, runtime?: ModelRuntimeConfig): Promise<void> {
    return this.send("setModel", {
      provider,
      model,
      thinking,
      ...(runtime?.contextWindow != null ? { contextWindow: runtime.contextWindow } : {}),
      ...(runtime?.maxOutputTokens != null ? { maxOutputTokens: runtime.maxOutputTokens } : {}),
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
  attachAgent(id: string): Promise<void> {
    return this.send("attachAgent", { id }) as Promise<void>;
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
  sendAgentMessage(agentId: string, message: string): Promise<void> {
    return this.send("sendAgentMessage", { agentId, message }) as Promise<void>;
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
}

// ---------------------------------------------------------------------------
// Browser fallback (dev without Tauri) — returns neutral data and simulates a
// connection lifecycle (connecting -> connected) so the shell's live status
// indicator is demonstrable in the browser preview.
// ---------------------------------------------------------------------------

const LOCAL_MODEL_CONFIG_KEY = "prime-agent.modelConfig.v1";

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

export class MockIpcClient implements IpcClient {
  private listeners: Array<(e: IpcEvent) => void> = [];
  private mockSettings: Settings = {
    theme: "dark",
    modelConfig: readLocalModelConfig(),
  };
  private state: ConnectionState = {
    status: { kind: "connecting" },
    model: { provider: "ollama-cloud", model: "deepseek-v4-flash:0731-cloud" },
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
  async setModel(provider: string, model: string, _thinking?: string, runtime?: ModelRuntimeConfig): Promise<void> {
    if (runtime) {
      this.applyModelRuntime(provider, model, runtime);
    }
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
      { id: "session-2", title: "Prime Agent — Windows", status: "idle", cwd: "C:\\work\\prime-agent-windows", createdAt: new Date(Date.now() - 172800000).toISOString() },
    ];
  }
  async listAgents(): Promise<AgentInfo[]> {
    return [];
  }
  async attachAgent(): Promise<void> {}
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
    return [
      { id: "ollama-cloud", name: "Ollama Cloud", kind: "api_key", connected: true, models: [] },
      { id: "openrouter", name: "OpenRouter", kind: "api_key", connected: true, models: [] },
      { id: "minimax", name: "MiniMax", kind: "api_key", connected: true, models: [] },
      { id: "opencode", name: "Codex (OpenCode)", kind: "api_key", connected: true, models: [] },
    ];
  }
  async login(): Promise<void> {}
  async logout(): Promise<void> {}
  async getSettings(): Promise<Settings> {
    return { ...this.mockSettings, modelConfig: { ...(this.mockSettings.modelConfig ?? {}) } };
  }
  async setSettings(settings: Settings): Promise<void> {
    const next = { ...this.mockSettings, ...settings };
    if (settings.modelConfig !== undefined) {
      // Replace (not merge) — mirrors the bridge SettingsStore.update() semantics,
      // so a reset that removes a key actually drops it from the persisted config.
      next.modelConfig = settings.modelConfig;
    }
    this.mockSettings = next;
    writeLocalModelConfig(next.modelConfig ?? {});
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
      { id: "rlm-1", name: "api-reviewer", status: "running" as const, parentId: this.activeSessionId, summary: "Reviewing endpoint contracts" },
      { id: "rlm-2", name: "test-runner", status: "idle" as const, parentId: this.activeSessionId, summary: "Awaiting next batch" },
    ];
  }
  async sendAgentMessage(): Promise<void> {}
  async listInbox(): Promise<AgentMessage[]> {
    return [];
  }
  async markMessageRead(): Promise<void> {}
  async compact(_prompt?: string): Promise<void> {}
  async retry(): Promise<void> {}
  async refine(): Promise<void> {}
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
