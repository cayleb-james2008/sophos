// client.test.ts — the IPC client's browser fallback (MockIpcClient) and the
// React hooks. We drive the mock's simulated connection lifecycle with fake
// timers and verify command behavior, event emission, and the singleton
// factory. `isTauri` is false in jsdom, so all of this exercises the browser
// preview path the contract asks us to cover.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

type IpcModule = typeof import("../client");

/** Each test gets a fresh module registry so the MockIpcClient singleton (and
 *  its one-shot simulation flag / in-memory state) starts clean. React lives in
 *  node_modules and is externalized, so its identity is preserved across
 *  resetModules — hooks stay valid. */
async function freshModule(): Promise<IpcModule> {
  vi.resetModules();
  return await import("../client");
}

beforeEach(() => {
  localStorage.clear();
  vi.useRealTimers();
});

describe("factory / environment", () => {
  it("runs the browser path (isTauri is false in jsdom)", async () => {
    const mod = await freshModule();
    expect(mod.isTauri).toBe(false);
  });

  it("getIpcClient returns a stable singleton and exposes it on window", async () => {
    const mod = await freshModule();
    const a = mod.getIpcClient();
    const b = mod.getIpcClient();
    expect(a).toBe(b);
    expect((window as any).__sophosIpc).toBe(a);
    expect(a.constructor.name).toBe("MockIpcClient");
  });

  it("exports the Tauri-backed client class for the native path", async () => {
    const mod = await freshModule();
    expect(typeof mod.TauriIpcClient).toBe("function");
  });
});

describe("connection lifecycle", () => {
  it("starts connecting, then transitions to connected with a snapshot", async () => {
    const mod = await freshModule();
    const client = mod.getIpcClient();

    const events: any[] = [];
    client.onEvent((e) => events.push(e));

    // startSimulation emits connecting synchronously on first subscription.
    expect(
      events.some((e) => e.type === "connection_status" && e.status.kind === "connecting"),
    ).toBe(true);

    // The mock flips to connected after ~600ms (real timer).
    await waitFor(
      () =>
        expect(
          events.some((e) => e.type === "connection_status" && e.status.kind === "connected"),
        ).toBe(true),
      { timeout: 5000 },
    );
    expect(events.some((e) => e.type === "snapshot")).toBe(true);
  });

  it("stops delivering events after the subscriber unsubscribes", async () => {
    const mod = await freshModule();
    const client = mod.getIpcClient();
    const events: any[] = [];
    const off = client.onEvent((e) => events.push(e));
    events.length = 0;

    off();
    await client.prompt("nobody listening");
    expect(events).toEqual([]);
  });
});

describe("MockIpcClient commands", () => {
  it("lists the demo sessions", async () => {
    const mod = await freshModule();
    const client = mod.getIpcClient();
    const sessions = await client.listSessions();
    expect(sessions.length).toBeGreaterThanOrEqual(3);
    expect(sessions[0].status).toBe("active");
    expect(sessions[0].title).toBe("Refactor auth module");
  });

  it("returns a neutral agent list and browser-preview runtime", async () => {
    const mod = await freshModule();
    const client = mod.getIpcClient();
    expect(await client.listAgents()).toEqual([]);
    const runtime = await client.getRuntimeInfo();
    expect(runtime.kernel.status).toBe("browser-preview");
    expect(runtime.kernel.persistent).toBe(false);
  });

  it("getModels returns the demo model catalog", async () => {
    const mod = await freshModule();
    const client = mod.getIpcClient();
    const models = await client.getModels();
    expect(models.some((m) => m.id === "deepseek-v4-flash:0731-cloud")).toBe(true);
    expect(models.some((m) => m.id === "MiniMax-M3")).toBe(true);
  });

  it("login/logout flips the provider connected state", async () => {
    const mod = await freshModule();
    const client = mod.getIpcClient();

    const connected = (id: string) =>
      (async () => {
        const providers = await client.getProviders();
        return providers.find((p) => p.id === id)?.connected ?? false;
      })();

    expect(await connected("ollama-cloud")).toBe(true);
    await client.logout("ollama-cloud");
    expect(await connected("ollama-cloud")).toBe(false);
    await client.login("ollama-cloud");
    expect(await connected("ollama-cloud")).toBe(true);
  });

  it("setModel updates the model, persists defaults, and emits a snapshot", async () => {
    const mod = await freshModule();
    const client = mod.getIpcClient();
    const events: any[] = [];
    client.onEvent((e) => events.push(e));

    await client.setModel("openrouter", "gpt-4o", "low");
    const state = await client.getState();
    expect(state.model?.provider).toBe("openrouter");
    expect(state.model?.model).toBe("gpt-4o");
    expect(events.some((e) => e.type === "snapshot")).toBe(true);

    // Persisted default survives a reload (new module instance reads localStorage).
    const mod2 = await freshModule();
    const settings = await mod2.getIpcClient().getSettings();
    expect(settings.defaultProvider).toBe("openrouter");
    expect(settings.defaultModel).toBe("gpt-4o");
  });

  it("prompt emits a session_event with the user message", async () => {
    const mod = await freshModule();
    const client = mod.getIpcClient();
    const events: any[] = [];
    client.onEvent((e) => events.push(e));

    await client.prompt("hello world");
    const ev = events.find((e) => e.type === "session_event");
    expect(ev.event.kind).toBe("user_message");
    expect(ev.event.text).toBe("hello world");
  });

  it("sideQuestion emits a running side-question event", async () => {
    const mod = await freshModule();
    const client = mod.getIpcClient();
    const events: any[] = [];
    client.onEvent((e) => events.push(e));

    const { id } = await client.sideQuestion("what is this?");
    expect(id).toContain("side-");
    const ev = events.find((e) => e.type === "session_event");
    expect(ev.event.kind).toBe("side_question_event");
    expect(ev.event.status).toBe("running");
  });

  it("testMcpServer reports a failure for an empty command", async () => {
    const mod = await freshModule();
    const client = mod.getIpcClient();
    const bad = await client.testMcpServer("mcp", "");
    expect(bad.connected).toBe(false);
    expect(bad.error).toBe("Command not found");

    const good = await client.testMcpServer("mcp", "npx some-server");
    expect(good.connected).toBe(true);
    expect(good.tools).toEqual(["search", "fetch"]);
  });

  it("getSessionTree returns the demo tree and leafId", async () => {
    const mod = await freshModule();
    const client = mod.getIpcClient();
    const tree = await client.getSessionTree();
    expect(tree.tree[0].id).toBe("entry-1");
    expect(tree.leafId).toBe("entry-2");
  });
});

describe("React hooks", () => {
  it("useIpc returns the stable singleton across renders", async () => {
    const mod = await freshModule();
    const { result, rerender } = renderHook(() => mod.useIpc());
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
    expect(result.current).toBe(mod.getIpcClient());
  });

  it("useConnectionState transitions to connected after the simulation", async () => {
    const mod = await freshModule();
    const { result } = renderHook(() => mod.useConnectionState());
    // Starts connecting.
    expect(result.current.status.kind).toBe("connecting");
    // The mock's simulation flips to connected after ~600ms (real timer).
    await waitFor(() => expect(result.current.status.kind).toBe("connected"), { timeout: 5000 });
  });

  it("useIpcEvent invokes the callback for emitted events", async () => {
    const mod = await freshModule();
    const cb = vi.fn();
    renderHook(() => mod.useIpcEvent(cb));
    const client = mod.getIpcClient();
    await client.prompt("ping");
    await waitFor(() =>
      expect(cb.mock.calls.some((call) => call[0].type === "session_event")).toBe(true),
    );
  });
});
