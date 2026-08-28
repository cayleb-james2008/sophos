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
import { MockIpcClient } from "./mockClient";
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
  ThoughtTreeState,
} from "./contract";

/** True when running inside the Tauri shell (real IPC); false in the browser preview. */
export const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/**
 * True when running inside the real Tauri demo shell: launched with `--demo`
 * or `SOPHOS_DEMO_MODE=1`, which makes the Rust shell inject
 * `window.__SOPHOS_DEMO__ = true`. In this mode the frontend uses the
 * MockIpcClient and the UI must be fully usable (composer enabled, onboarding
 * skipped) so the desktop app is demonstrable + testable without a live
 * provider.
 */
export function isDemoShell(): boolean {
  return typeof window !== "undefined" && window.__SOPHOS_DEMO__ === true;
}

/**
 * True when the app is in demo mode: the Tauri `--demo` shell (isDemoShell) or
 * the browser preview (not Tauri), including the `#demo` dev-server opt-in. In
 * demo mode the frontend uses the MockIpcClient.
 */
export function isDemoMode(): boolean {
  return (
    isDemoShell() || !isTauri || (typeof window !== "undefined" && window.location.hash.includes("demo"))
  );
}

// Re-export the demo client so existing imports (`import { MockIpcClient }
// from "@/ipc/client"`) keep working after the mock was split out.
export { MockIpcClient } from "./mockClient";

export interface IpcClient {
  // Commands
  prompt(
    text: string,
    options?: {
      thinking?: string;
      streamingBehavior?: "steer" | "followUp";
      queueIfBusy?: boolean;
      profile?: string;
      profileFlavor?: { name: string; tagline: string; workingStyle: string[]; mode?: string };
    },
  ): Promise<void>;
  abort(): Promise<void>;
  steer(text: string): Promise<void>;
  setModel(provider: string, model: string, thinking?: string, runtime?: ModelRuntimeConfig): Promise<void>;
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
  createSkill(input: {
    name: string;
    description: string;
    content: string;
    pythonImport?: string;
  }): Promise<RuntimeSkill>;
  installSkill(path: string): Promise<RuntimeSkill[]>;
  installExtension(path: string): Promise<void>;
  removeExtension(path: string): Promise<void>;
  getExtensions(): Promise<ExtensionInfo[]>;
  testMcpServer(name: string, command: string, args?: string[]): Promise<McpTestResult>;
  getSlashCommands(): Promise<SlashCommand[]>;
  getMemoryState(tier?: MemoryTier): Promise<MemoryState>;
  searchMemory(query: string, tier?: MemoryTier, maxResults?: number): Promise<MemoryTierEntry[]>;
  storeMemory(entry: Omit<MemoryTierEntry, "id">): Promise<MemoryTierEntry>;
  recallMemory(query: string, limit?: number): Promise<string[]>;
  forgetMemory(id: string): Promise<void>;
  createCheckpoint(label: string, summary?: string): Promise<CheckpointEntry>;
  restoreCheckpoint(id: string): Promise<CheckpointEntry>;
  listCheckpoints(sessionId?: string): Promise<CheckpointEntry[]>;
  getSquadTopology(): Promise<SquadTopology>;
  evaluateSquadPiece(
    childId: string,
    pieceContract: string,
    bar: string,
    outputPaths: string[],
  ): Promise<BlindCriticRubric>;

  // Model Context Protocol (MCP) Standard
  getMcpServers(): Promise<McpServerDetails[]>;
  readMcpResource(serverName: string, uri: string): Promise<McpResource>;
  getMcpPrompt(
    serverName: string,
    name: string,
    args?: Record<string, string>,
  ): Promise<{ description?: string; messages: Array<{ role: "user" | "assistant"; content: string }> }>;

  // Workspace Security Sandbox (SWE-agent)
  getSecurityPolicy(): Promise<{ policy: WorkspaceSecurityPolicy; customBlockedPatterns: string[] }>;
  setSecurityPolicy(policy: WorkspaceSecurityPolicy, customBlockedPatterns?: string[]): Promise<void>;
  analyzeBlastRadius(command: string, targetFiles?: string[]): Promise<BlastRadiusReport>;
  getSecurityAuditLog(): Promise<SecurityAuditEntry[]>;

  // Dynamic Squad Workflows (LangGraph / AutoGen 0.4)
  getSquadWorkflow(): Promise<SquadWorkflowState>;
  runSquadWorkflow(type: SquadWorkflowType, goal: string, bar: string): Promise<SquadWorkflowState>;
  pauseSquadWorkflow(id: string): Promise<void>;

  // Token Budget & Context Optimizer (DSPy / MemGPT)
  getTokenBudget(): Promise<TokenBudgetBreakdown>;
  compactContext(
    strategy: "semantic-summarize" | "prune-oldest" | "evict-tools",
  ): Promise<{ beforeTokens: number; afterTokens: number; savedTokens: number }>;

  // Native Windows Computer-Use Action Space (CUA & UIA)
  listDesktopWindows(): Promise<DesktopWindowInfo[]>;
  inspectDesktopWindow(windowId: string): Promise<DesktopUiElement>;
  dispatchDesktopAction(windowId: string, action: DesktopUiAction): Promise<DesktopActionResult>;
  captureDesktopScreenshot(windowId: string): Promise<string>;

  // Self-Evolving Skill Distillation Engine (Voyager / Eureka)
  listDistilledSkills(): Promise<DistilledSkill[]>;
  distillSkillFromTrajectory(sessionId: string, name?: string): Promise<DistilledSkill>;
  promoteSkill(skillId: string): Promise<{ success: boolean; targetPath: string }>;
  deleteDistilledSkill(skillId: string): Promise<void>;

  // Speculative Tree-of-Thoughts Engine (ToT / FoT)
  getThoughtTree(): Promise<ThoughtTreeState>;
  runSpeculativeBranch(parentNodeId: string, hypothesis: string): Promise<ThoughtTreeState>;
  pruneThoughtBranch(nodeId: string): Promise<ThoughtTreeState>;
  promoteThoughtBranch(nodeId: string): Promise<ThoughtTreeState>;

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
    this.responseUnlisten = await listen<{ id?: string; result?: unknown; error?: { message: string } }>(
      "ipc-response",
      (e) => {
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
      },
    );
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
  attachAgent(id: string): Promise<{ childId: string; sessionId: string; attached: true }> {
    return this.send("attachAgent", { id }) as Promise<{
      childId: string;
      sessionId: string;
      attached: true;
    }>;
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
  createSkill(input: {
    name: string;
    description: string;
    content: string;
    pythonImport?: string;
  }): Promise<RuntimeSkill> {
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
  getMemoryState(tier?: MemoryTier): Promise<MemoryState> {
    return this.send("getMemoryState", { tier }) as Promise<MemoryState>;
  }
  searchMemory(query: string, tier?: MemoryTier, maxResults?: number): Promise<MemoryTierEntry[]> {
    return this.send("searchMemory", { query, tier, maxResults }) as Promise<MemoryTierEntry[]>;
  }
  storeMemory(entry: Omit<MemoryTierEntry, "id">): Promise<MemoryTierEntry> {
    return this.send("storeMemory", { entry }) as Promise<MemoryTierEntry>;
  }
  recallMemory(query: string, limit?: number): Promise<string[]> {
    return this.send("recallMemory", { query, limit }) as Promise<string[]>;
  }
  forgetMemory(id: string): Promise<void> {
    return this.send("forgetMemory", { id }) as Promise<void>;
  }
  createCheckpoint(label: string, summary?: string): Promise<CheckpointEntry> {
    return this.send("createCheckpoint", { label, summary }) as Promise<CheckpointEntry>;
  }
  restoreCheckpoint(id: string): Promise<CheckpointEntry> {
    return this.send("restoreCheckpoint", { id }) as Promise<CheckpointEntry>;
  }
  listCheckpoints(sessionId?: string): Promise<CheckpointEntry[]>;
  listCheckpoints(sessionId?: string): Promise<CheckpointEntry[]> {
    return this.send("listCheckpoints", { sessionId }) as Promise<CheckpointEntry[]>;
  }
  getSquadTopology(): Promise<SquadTopology> {
    return this.send("getSquadTopology", {}) as Promise<SquadTopology>;
  }
  evaluateSquadPiece(
    childId: string,
    pieceContract: string,
    bar: string,
    outputPaths: string[],
  ): Promise<BlindCriticRubric> {
    return this.send("evaluateSquadPiece", {
      childId,
      pieceContract,
      bar,
      outputPaths,
    }) as Promise<BlindCriticRubric>;
  }
  getMcpServers(): Promise<McpServerDetails[]> {
    return this.send("getMcpServers", {}) as Promise<McpServerDetails[]>;
  }
  readMcpResource(serverName: string, uri: string): Promise<McpResource> {
    return this.send("readMcpResource", { serverName, uri }) as Promise<McpResource>;
  }
  getMcpPrompt(
    serverName: string,
    name: string,
    args?: Record<string, string>,
  ): Promise<{ description?: string; messages: Array<{ role: "user" | "assistant"; content: string }> }> {
    return this.send("getMcpPrompt", { serverName, name, args }) as Promise<{
      description?: string;
      messages: Array<{ role: "user" | "assistant"; content: string }>;
    }>;
  }
  getSecurityPolicy(): Promise<{ policy: WorkspaceSecurityPolicy; customBlockedPatterns: string[] }> {
    return this.send("getSecurityPolicy", {}) as Promise<{
      policy: WorkspaceSecurityPolicy;
      customBlockedPatterns: string[];
    }>;
  }
  setSecurityPolicy(policy: WorkspaceSecurityPolicy, customBlockedPatterns?: string[]): Promise<void> {
    return this.send("setSecurityPolicy", { policy, customBlockedPatterns }) as Promise<void>;
  }
  analyzeBlastRadius(command: string, targetFiles?: string[]): Promise<BlastRadiusReport> {
    return this.send("analyzeBlastRadius", { command, targetFiles }) as Promise<BlastRadiusReport>;
  }
  getSecurityAuditLog(): Promise<SecurityAuditEntry[]> {
    return this.send("getSecurityAuditLog", {}) as Promise<SecurityAuditEntry[]>;
  }
  getSquadWorkflow(): Promise<SquadWorkflowState> {
    return this.send("getSquadWorkflow", {}) as Promise<SquadWorkflowState>;
  }
  runSquadWorkflow(type: SquadWorkflowType, goal: string, bar: string): Promise<SquadWorkflowState> {
    return this.send("runSquadWorkflow", { type, goal, bar }) as Promise<SquadWorkflowState>;
  }
  pauseSquadWorkflow(id: string): Promise<void> {
    return this.send("pauseSquadWorkflow", { id }) as Promise<void>;
  }
  getTokenBudget(): Promise<TokenBudgetBreakdown> {
    return this.send("getTokenBudget", {}) as Promise<TokenBudgetBreakdown>;
  }
  compactContext(
    strategy: "semantic-summarize" | "prune-oldest" | "evict-tools",
  ): Promise<{ beforeTokens: number; afterTokens: number; savedTokens: number }> {
    return this.send("compactContext", { strategy }) as Promise<{
      beforeTokens: number;
      afterTokens: number;
      savedTokens: number;
    }>;
  }
  listDesktopWindows(): Promise<DesktopWindowInfo[]> {
    return this.send("listDesktopWindows", {}) as Promise<DesktopWindowInfo[]>;
  }
  inspectDesktopWindow(windowId: string): Promise<DesktopUiElement> {
    return this.send("inspectDesktopWindow", { windowId }) as Promise<DesktopUiElement>;
  }
  dispatchDesktopAction(windowId: string, action: DesktopUiAction): Promise<DesktopActionResult> {
    return this.send("dispatchDesktopAction", { windowId, action }) as Promise<DesktopActionResult>;
  }
  captureDesktopScreenshot(windowId: string): Promise<string> {
    return this.send("captureDesktopScreenshot", { windowId }) as Promise<string>;
  }
  listDistilledSkills(): Promise<DistilledSkill[]> {
    return this.send("listDistilledSkills", {}) as Promise<DistilledSkill[]>;
  }
  distillSkillFromTrajectory(sessionId: string, name?: string): Promise<DistilledSkill> {
    return this.send("distillSkillFromTrajectory", { sessionId, name }) as Promise<DistilledSkill>;
  }
  promoteSkill(skillId: string): Promise<{ success: boolean; targetPath: string }> {
    return this.send("promoteSkill", { skillId }) as Promise<{ success: boolean; targetPath: string }>;
  }
  deleteDistilledSkill(skillId: string): Promise<void> {
    return this.send("deleteDistilledSkill", { skillId }) as Promise<void>;
  }
  getThoughtTree(): Promise<ThoughtTreeState> {
    return this.send("getThoughtTree", {}) as Promise<ThoughtTreeState>;
  }
  runSpeculativeBranch(parentNodeId: string, hypothesis: string): Promise<ThoughtTreeState> {
    return this.send("runSpeculativeBranch", { parentNodeId, hypothesis }) as Promise<ThoughtTreeState>;
  }
  pruneThoughtBranch(nodeId: string): Promise<ThoughtTreeState> {
    return this.send("pruneThoughtBranch", { nodeId }) as Promise<ThoughtTreeState>;
  }
  promoteThoughtBranch(nodeId: string): Promise<ThoughtTreeState> {
    return this.send("promoteThoughtBranch", { nodeId }) as Promise<ThoughtTreeState>;
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
  // Demo mode: the Rust shell injects `window.__SOPHOS_DEMO__ = true` when the
  // app is launched with `--demo` (or SOPHOS_DEMO_MODE=1). In demo mode the
  // app uses the MockIpcClient so the full UI is demonstrable and testable
  // without a live daemon/provider — the same simulated sessions, agents, and
  // messages the browser preview uses. The URL-hash check keeps the dev
  // server (`http://localhost:1420/#demo`) able to opt in without the shell.
  const demoMode = isDemoMode();
  client = inTauri && !demoMode ? new TauriIpcClient() : new MockIpcClient();
  // Expose on window in browser/demo mode so the e2e test harness can patch
  // the singleton directly (Vite HMR creates separate module instances per
  // `?t=` timestamp, so `import()` in page.evaluate resolves to a different
  // module than the app loaded — patching that prototype has no effect on the
  // already-instantiated singleton). In Tauri this is a no-op (the mock isn't
  // used). Harmless in production.
  if (typeof window !== "undefined" && (!inTauri || demoMode)) {
    window.__sophosIpc = client;
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
    client
      .getState()
      .then((s) => {
        if (mounted && s) setState(s);
      })
      .catch(() => {
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
