// contract.test.ts — the IPC contract is a type-only module (no runtime
// exports). This test exercises the contract by building representative
// payloads that must satisfy the exported types, then asserts their runtime
// structure. It keeps the shared type surface honest (a structural change to a
// type used here fails compilation, catching accidental drift).
//
// The `satisfies` assertions are checked at compile time by `tsc --noEmit`; the
// runtime assertions verify the shapes the frontend actually depends on.

import { describe, it, expect } from "vitest";
import type {
  ConnectionState,
  ConnectionStatus,
  IpcCommand,
  IpcEvent,
  SessionInfo,
  AgentInfo,
  AgentMessage,
  ProviderInfo,
  Settings,
  SessionTree,
  McpTestResult,
  SlashCommand,
  ModelInfo,
} from "../contract";

describe("contract — ConnectionState", () => {
  it("accepts the minimal connecting state", () => {
    const state: ConnectionState = { status: { kind: "connecting" } };
    expect(state.status.kind).toBe("connecting");
  });

  it("carries optional model/context/cost fields when present", () => {
    const state: ConnectionState = {
      status: { kind: "connected" },
      model: { provider: "ollama-cloud", model: "deepseek-v4-flash:0731-cloud" },
      context: { tokens: 18432, contextWindow: 1000000, messages: 42 },
      costStats: { totalCost: 0.84, sessionCost: 0.31 },
    };
    expect(state.model?.provider).toBe("ollama-cloud");
    expect(state.context?.tokens).toBe(18432);
    expect(state.costStats?.totalCost).toBe(0.84);
  });

  it("supports a disconnected status with a reason", () => {
    const status: ConnectionStatus = { kind: "disconnected", reason: "pipe closed" };
    expect(status.reason).toBe("pipe closed");
  });
});

describe("contract — IpcCommand", () => {
  it("accepts a prompt command with options", () => {
    const cmd: IpcCommand = {
      method: "prompt",
      params: { text: "hello", options: { thinking: "low", streamingBehavior: "followUp" } },
    };
    expect(cmd.params.options?.streamingBehavior).toBe("followUp");
  });

  it("accepts a setModel command carrying runtime overrides", () => {
    const cmd: IpcCommand = {
      method: "setModel",
      params: { provider: "openrouter", model: "gpt-4o", contextWindow: 128000, maxOutputTokens: 8192 },
    };
    expect(cmd.params.contextWindow).toBe(128000);
  });

  it("accepts a settings command with an arbitrary settings payload", () => {
    const cmd: IpcCommand = { method: "setSettings", params: { settings: { theme: "light" } } };
    expect(cmd.params.settings).toEqual({ theme: "light" });
  });
});

describe("contract — IpcEvent", () => {
  it("distinguishes session_event from connection_status", () => {
    const ev: IpcEvent = { type: "session_event", event: { kind: "text", text: "hi" } };
    expect(ev.type).toBe("session_event");
    const conn: IpcEvent = { type: "connection_status", status: { kind: "connected" } };
    expect(conn.type).toBe("connection_status");
  });

  it("carries agent_message unread metadata", () => {
    const msg: AgentMessage = {
      id: "m1",
      fromAgentId: "child-1",
      fromAgentName: "reviewer",
      toAgentId: "self",
      text: "review complete",
      read: false,
    };
    const ev: IpcEvent = { type: "agent_message", message: msg };
    expect(ev.message.fromAgentId).toBe("child-1");
  });
});

describe("contract — data shapes used by the shell/views", () => {
  it("SessionInfo describes the active session", () => {
    const s: SessionInfo = {
      id: "session-0",
      title: "Refactor auth module",
      status: "active",
      cwd: "C:\\work\\api-service",
      createdAt: "2026-01-01T00:00:00.000Z",
    };
    expect(s.status).toBe("active");
  });

  it("AgentInfo distinguishes running vs idle", () => {
    const a: AgentInfo = { id: "a1", name: "api-reviewer", status: "running", sessionId: "s1" };
    expect(a.status).toBe("running");
  });

  it("ProviderInfo models api_key and subscription kinds", () => {
    const p: ProviderInfo = { id: "prime-intellect", name: "Prime Intellect", kind: "subscription", connected: true, models: [] };
    expect(p.kind).toBe("subscription");
  });

  it("ModelInfo carries effective + ceiling token bounds", () => {
    const m: ModelInfo = {
      id: "deepseek-v4-flash:0731-cloud",
      provider: "ollama-cloud",
      contextWindow: 1000000,
      maxContextWindow: 1000000,
    };
    expect(m.contextWindow).toBe(1000000);
  });

  it("Settings accepts theme + per-model runtime overrides", () => {
    const s: Settings = { theme: "dark", modelConfig: { "p:m": { contextWindow: 50000 } } };
    expect(s.theme).toBe("dark");
    expect(s.modelConfig?.["p:m"].contextWindow).toBe(50000);
  });

  it("SessionTree nests message nodes", () => {
    const tree: SessionTree = {
      tree: [{ id: "e1", type: "message", label: "brief", parentId: null, children: [{ id: "e2", type: "message", parentId: "e1" }] }],
      leafId: "e2",
    };
    expect(tree.leafId).toBe("e2");
  });

  it("McpTestResult reports connection state and tool count", () => {
    const r: McpTestResult = { serverName: "mcp", connected: true, latencyMs: 42, tools: ["search"] };
    expect(r.connected).toBe(true);
  });

  it("SlashCommand carries its source", () => {
    const c: SlashCommand = { name: "refine", description: "Refine", source: "builtin" };
    expect(c.source).toBe("builtin");
  });
});
