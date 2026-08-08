// JSON-RPC over stdio.
//
// Reads one JSON line per command from stdin, dispatches to the AgentConnection
// via the ConnectionHolder, and writes one JSON line per response/event to
// stdout. Stderr is reserved for human-readable diagnostics (logs, crashes).
//
// Framing: NDJSON (newline-delimited JSON). Each line on stdout is a single
// JSON document. Responses are identified by `id`; events have no `id`.
//
// Robustness rules:
//   * Malformed JSON on stdin → JSON-RPC -32700 (parse error). Don't crash.
//   * Unknown method → JSON-RPC -32601 (method not found).
//   * Missing/invalid params → JSON-RPC -32602.
//   * Internal errors → JSON-RPC -32603, with the error message as data.
//   * Writes to stdout are serialized to keep lines atomic.

import { createInterface } from "node:readline";
import type { Readable, Writable } from "node:stream";

import type {
  AgentInfo,
  AgentMessage,
  ConnectionState,
  IpcEvent,
  Settings,
} from "../../src/ipc/contract.js";
import {
  ConnectionHolder,
  enrichConnectionState,
  getModels as connGetModels,
  getProviders as connGetProviders,
  getTranscript as connGetTranscript,
  listSessions as connListSessions,
  mapConnectionState,
  mapContextTree,
  mapCronJobToSchedule,
  mapSessionTree,
  writeAuthKey,
  writeModelOverrideToModelsJson,
  type AgentConnectionRlmChild,
} from "./connection.js";

// ---------------------------------------------------------------------------
// JSON-RPC envelope (subset of JSON-RPC 2.0 — we don't require a version
// field because the Rust shell uses method-tagged objects).
// ---------------------------------------------------------------------------

interface RpcRequest {
  id?: string | number | null;
  method: string;
  params?: unknown;
}

interface RpcResponse {
  id: string | number | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

interface RpcEventEnvelope {
  event: IpcEvent;
}

const JSON_RPC_ERROR = {
  parseError: -32700,
  invalidRequest: -32600,
  methodNotFound: -32601,
  invalidParams: -32602,
  internalError: -32603,
} as const;

// ---------------------------------------------------------------------------
// RpcServer
// ---------------------------------------------------------------------------

export interface RpcServerOptions {
  stdin: Readable;
  stdout: Writable;
  stderr: Writable;
}

export class RpcServer {
  private readonly stdin: Readable;
  private readonly stdout: Writable;
  private readonly stderr: Writable;
  private readonly holder: ConnectionHolder;
  private writeChain: Promise<void> = Promise.resolve();
  private closed = false;

  constructor(holder: ConnectionHolder, opts: RpcServerOptions) {
    this.holder = holder;
    this.stdin = opts.stdin;
    this.stdout = opts.stdout;
    this.stderr = opts.stderr;
  }

  /** Begin reading commands from stdin. */
  start(): void {
    const rl = createInterface({ input: this.stdin, crlfDelay: Infinity });
    rl.on("line", (line) => {
      // Trim and skip blank lines (e.g. trailing newline from heredocs).
      const trimmed = line.trim();
      if (!trimmed) return;
      void this.handleLine(trimmed);
    });
    rl.on("close", () => {
      this.closed = true;
      // Best-effort cleanup — daemon connection is owned by the caller.
      void this.holder.disconnect();
    });
  }

  /** Push an event to the Rust shell. Safe to call from anywhere. */
  emitEvent(event: IpcEvent): void {
    // Send the event directly (no RpcEventEnvelope wrapper) — the Rust shell
    // parses each stdout line as IpcEvent via #[serde(tag = "type")].
    this.writeLine(JSON.stringify(event) + "\n").catch((err) => {
      this.logError("failed to write event", err);
    });
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private async handleLine(line: string): Promise<void> {
    let parsed: RpcRequest;
    try {
      parsed = JSON.parse(line);
    } catch (err) {
      await this.respondError(null, JSON_RPC_ERROR.parseError, "parse error", String(err));
      return;
    }
    if (!parsed || typeof parsed !== "object" || typeof parsed.method !== "string") {
      await this.respondError(null, JSON_RPC_ERROR.invalidRequest, "invalid request");
      return;
    }
    const id = (parsed.id ?? null) as string | number | null;
    try {
      const result = await this.dispatch(parsed.method, parsed.params);
      await this.respondOk(id, result);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const code = (err as { code?: number })?.code ?? JSON_RPC_ERROR.internalError;
      await this.respondError(id, code, message);
    }
  }

  private async dispatch(method: string, params: unknown): Promise<unknown> {
    // All IpcCommand methods are dispatched here. Each branch validates
    // params and returns either void or a typed shape.
    switch (method) {
      case "prompt": {
        const p = requireParams<{ text: string; options?: { thinking?: string; serviceTier?: string; transport?: string; goal?: string } }>(params, ["text"]);
        const conn = this.requireConn();
        const opts = p.options ? {
          ...(p.options.thinking ? { streamingBehavior: "followUp" as const } : {}),
        } : undefined;
        await conn.prompt(p.text, opts);
        return undefined;
      }

      case "abort": {
        const conn = this.requireConn();
        await conn.abort();
        return undefined;
      }

      case "steer": {
        const p = requireParams<{ text: string }>(params, ["text"]);
        const conn = this.requireConn();
        await conn.steer(p.text);
        return undefined;
      }

      case "setModel": {
        const p = requireParams<{ provider: string; model: string; thinking?: string; serviceTier?: string; transport?: string; contextWindow?: number; maxOutputTokens?: number }>(params, ["provider", "model"]);
        const conn = this.requireConn();
        // Apply runtime overrides (context window / max output tokens) to the
        // ENGINE, not just settings. The daemon re-reads ~/.prime/agent/models.json
        // on every set_model, so the real path is: write the override into the
        // model catalog, then issue setModel so the daemon reloads the catalog and
        // the request uses the new definition. Also persist to the app settings
        // store so the UI / reconnect path retains it.
        const runtime = { contextWindow: p.contextWindow, maxOutputTokens: p.maxOutputTokens };
        if (p.contextWindow != null || p.maxOutputTokens != null) {
          const key = `${p.provider}:${p.model}`;
          const store = this.holder.getSettingsStore();
          const current = store.get();
          const modelConfig = { ...(current.modelConfig ?? {}) };
          const prev = { ...(modelConfig[key] ?? {}) };
          if (p.contextWindow != null) prev.contextWindow = p.contextWindow;
          if (p.maxOutputTokens != null) prev.maxOutputTokens = p.maxOutputTokens;
          modelConfig[key] = prev;
          store.update({ modelConfig } as Settings);
          // Write the engine override BEFORE setModel so the daemon picks it up.
          writeModelOverrideToModelsJson(p.provider, p.model, {
            contextWindow: p.contextWindow,
            maxTokens: p.maxOutputTokens,
          });
        }
        const updated = await conn.setModel(p.provider, p.model);
        if (p.thinking) {
          // setThinkingLevel accepts the thinking enum; cast through unknown
          // since the exact union varies by provider.
          await conn.setThinkingLevel(p.thinking as never);
        }
        if (p.serviceTier) {
          await conn.setServiceTier(p.serviceTier as never);
        }
        if (p.transport) {
          await conn.setTransport(p.transport as never);
        }
        return { provider: updated.provider, model: updated.id };
      }

      case "newSession": {
        // The contract's newSession params carry cwd + goal. AgentConnection
        // only exposes parentSession, so when cwd/goal are present we have to
        // fall through to the raw daemon `create` command (via the holder's
        // client) which accepts AgentSessionRuntimeConfig.{cwd,initialGoal}.
        // The resulting session then needs to be re-attached, so we tear down
        // the current connection and start a fresh attach cycle.
        const p = optionalParams<{ cwd?: string; goal?: string }>(params) ?? {};
        const opts: { cwd?: string; goal?: string } = {};
        if (typeof p.cwd === "string") opts.cwd = p.cwd;
        if (typeof p.goal === "string") opts.goal = p.goal;
        if (Object.keys(opts).length === 0) {
          const conn = this.requireConn();
          return conn.newSession();
        }
        // cwd/goal present — re-attach via the daemon's create command. We
        // delegate to the holder's helper, which returns the new
        // activeSessionId; the holder then wires up a fresh DaemonAgentConnection.
        const activeSessionId = await this.holder.createSessionWithConfig(opts);
        return { cancelled: false, activeSessionId };
      }

      case "switchSession": {
        const p = requireParams<{ id: string }>(params, ["id"]);
        const conn = this.requireConn();
        return conn.switchSession(p.id);
      }

      case "resumeSession": {
        const p = requireParams<{ pathOrId: string }>(params, ["pathOrId"]);
        const conn = this.requireConn();
        return conn.switchSession(p.pathOrId);
      }

      case "forkSession": {
        // Contract param is a session identifier (path or id), but
        // AgentConnection.fork requires an entry id. Resolve the session
        // tree and pick the leaf entry as the fork point. If the caller
        // already passed an entry id (8-byte hex like 063dbbea6117), we
        // forward it as-is for ergonomics.
        const p = requireParams<{ pathOrId: string }>(params, ["pathOrId"]);
        const conn = this.requireConn();
        // Entry ids are short non-UUID strings — treat anything that looks
        // like one as a direct entry id; otherwise resolve via the tree.
        const looksLikeEntryId = /^[a-z0-9]{4,32}$/i.test(p.pathOrId) && !p.pathOrId.includes("/") && !p.pathOrId.includes("\\");
        if (looksLikeEntryId) {
          try {
            return await conn.fork(p.pathOrId);
          } catch (err) {
            // Fall through to tree resolution if the daemon rejects it as
            // an entry id.
            if (typeof process !== "undefined" && process.stderr) {
              const msg = err instanceof Error ? err.message : String(err);
              process.stderr.write(`[bridge:rpc] fork direct entryId failed, trying tree resolve: ${msg}\n`);
            }
          }
        }
        const entryId = await this.holder.resolveSessionToEntryId(conn, p.pathOrId);
        if (!entryId) {
          throw rpcError(JSON_RPC_ERROR.invalidParams, `cannot resolve fork entry for session: ${p.pathOrId}`);
        }
        return conn.fork(entryId);
      }

      case "listSessions": {
        const conn = this.requireConn();
        return connListSessions(conn);
      }

      case "listAgents": {
        // AgentConnection doesn't expose a top-level agents list, but the
        // session snapshot has `children` (RLM subagents). Map those to
        // AgentInfo for the UI.
        const snapshot = this.holder.getSnapshot();
        const children = snapshot?.children ?? [];
        const agents: AgentInfo[] = children.map((c: AgentConnectionRlmChild) => ({
          id: c.id,
          name: c.sessionName ?? c.label,
          status: (c.status === "queued" || c.status === "running") ? "running" : "saved",
          sessionId: c.activeSessionId,
        }));
        return agents;
      }

      case "attachAgent": {
        const p = requireParams<{ id: string }>(params, ["id"]);
        const conn = this.requireConn();
        const snapshot = this.holder.getSnapshot();
        const child = snapshot?.children?.find((c: AgentConnectionRlmChild) => c.id === p.id);
        if (!child?.activeSessionId) {
          throw rpcError(JSON_RPC_ERROR.invalidParams, `agent not found or not attachable: ${p.id}`);
        }
        // watchSession returns a watcher; we don't expose it through the IPC
        // contract yet, but invoking it exercises the attach path.
        const watcher = await conn.watchSession(child.activeSessionId);
        if (!watcher) {
          throw rpcError(JSON_RPC_ERROR.internalError, `failed to attach to agent ${p.id}`);
        }
        await watcher.close();
        return undefined;
      }

      case "getState": {
        const conn = this.holder.getConnection();
        if (!conn) {
          return {
            status: this.statusForNoConnection(),
          } satisfies ConnectionState;
        }
        let state = this.holder.getLatestState();
        try {
          if (!state) state = await conn.getState();
        } catch {
          // fall back to last known state
        }
        if (!state) {
          return { status: this.statusForNoConnection() } satisfies ConnectionState;
        }
        const mapped = mapConnectionState(
          state,
          this.holder.getStatus(),
          undefined,
          this.holder.getSnapshot(),
        );
        // Pull async-only fields (schedules, full heartbeat list, cost stats)
        // from the daemon; each is best-effort and left undefined on failure.
        return enrichConnectionState(conn, mapped);
      }

      case "getTranscript": {
        const conn = this.requireConn();
        return connGetTranscript(conn);
      }

      case "getModels": {
        const conn = this.requireConn();
        return connGetModels(conn);
      }

      case "getProviders": {
        const conn = this.requireConn();
        return connGetProviders(conn);
      }

      case "login": {
        // The daemon's AgentConnection exposes no auth flow. Interim solution
        // (scope limitation, per orchestrator): persist the key in the bridge
        // settings store AND mirror it into ~/.prime/agent/auth.json — the file
        // the daemon actually reads (AuthStorageData / ApiKeyCredential shape) —
        // so a login from the UI reaches the daemon like its own /login flow.
        const p = requireParams<{ provider: string; apiKey?: string }>(params, ["provider"]);
        const store = this.holder.getSettingsStore();
        const current = store.get();
        const auth = { ...(current.auth ?? {}) };
        if (p.apiKey) auth[p.provider] = p.apiKey;
        else delete auth[p.provider];
        store.update({ auth } as Settings);
        writeAuthKey(p.provider, p.apiKey);
        return { provider: p.provider, stored: Boolean(p.apiKey) };
      }

      case "logout": {
        // Remove only the target provider's key — settings store + auth.json mirror.
        const p = requireParams<{ provider: string }>(params, ["provider"]);
        const store = this.holder.getSettingsStore();
        const current = store.get();
        const auth = { ...(current.auth ?? {}) };
        delete auth[p.provider];
        store.update({ auth } as Settings);
        writeAuthKey(p.provider);
        return { provider: p.provider, stored: false };
      }

      case "getSettings": {
        return this.holder.getSettingsStore().get();
      }

      case "setSettings": {
        const p = requireParams<{ settings: Record<string, unknown> }>(params, ["settings"]);
        return this.holder.getSettingsStore().update(p.settings as Partial<Settings>);
      }

      case "runCommand": {
        // Map to executeBash — the contract calls it "runCommand" to match
        // the Tauri shell API; the daemon treats it as a transient bash run.
        const p = requireParams<{ command: string; args?: string[] }>(params, ["command"]);
        const conn = this.requireConn();
        const full = p.args && p.args.length > 0
          ? `${p.command} ${p.args.map(shellQuote).join(" ")}`
          : p.command;
        await conn.executeBash(full, { transient: true });
        return undefined;
      }

      case "getContextStats": {
        const conn = this.holder.getConnection();
        if (!conn) return undefined;
        try {
          const stats = await conn.getSessionStats();
          const cu = stats.contextUsage as unknown as Record<string, unknown> | undefined;
          return {
            tokens: typeof cu?.tokens === "number" ? (cu.tokens as number) : undefined,
            contextWindow: typeof cu?.contextWindow === "number" ? (cu.contextWindow as number) : undefined,
            messages: typeof stats.totalMessages === "number" ? stats.totalMessages : undefined,
          };
        } catch {
          return undefined;
        }
      }

      case "getRlmChildren": {
        const snapshot = this.holder.getSnapshot();
        const children = snapshot?.children ?? [];
        return children.map((c: AgentConnectionRlmChild) => ({
          id: c.id,
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

      case "sendAgentMessage": {
        const p = requireParams<{ agentId: string; message: string }>(params, ["agentId", "message"]);
        const conn = this.requireConn();
        const snapshot = this.holder.getSnapshot();
        const child = snapshot?.children?.find((c: AgentConnectionRlmChild) => c.id === p.agentId);
        const target = child?.activeSessionId;
        if (!target) {
          throw rpcError(JSON_RPC_ERROR.invalidParams, `agent ${p.agentId} not found`);
        }
        return conn.sendAgentMessage(target, p.message);
      }

      case "listInbox": {
        return this.holder.inbox.list();
      }

      case "markMessageRead": {
        const p = requireParams<{ messageId: string }>(params, ["messageId"]);
        return this.holder.inbox.markRead(p.messageId);
      }

      case "compact": {
        const p = optionalParams<{ prompt?: string }>(params);
        const conn = this.requireConn();
        return conn.compact(p?.prompt);
      }

      case "retry": {
        // No first-class retry on AgentConnection; treat as a no-op that
        // returns the current state so the caller can decide what to do.
        return undefined;
      }

      case "refine": {
        const conn = this.requireConn();
        return conn.refine();
      }

      case "exportSession": {
        // Export the current session. The daemon supports HTML and JSONL
        // exports; `format` defaults to html. Returns the written path.
        const p = optionalParams<{ format?: string }>(params) ?? {};
        const format = p.format === "jsonl" ? "jsonl" : "html";
        const conn = this.requireConn();
        const exportedPath = format === "jsonl"
          ? await conn.exportToJsonl()
          : await conn.exportToHtml();
        return { format, exportedPath };
      }

      case "shareSession": {
        // The daemon has no share/upload surface. Report it gracefully so the
        // frontend can disable/explain the action rather than hard-fail.
        throw rpcError(
          JSON_RPC_ERROR.methodNotFound,
          "shareSession is not yet supported by the daemon",
        );
      }

      case "getSessionTree": {
        const conn = this.requireConn();
        const tree = await conn.getSessionTree();
        return mapSessionTree(tree);
      }

      case "cloneSession": {
        // No first-class clone on the daemon's AgentConnection. A fork of the
        // current leaf is the closest primitive. After a successful fork the
        // daemon switches to the new session, so read back its id via getState.
        const conn = this.requireConn();
        const treeResp = await conn.getSessionTree();
        const leafId = treeResp?.leafId;
        if (typeof leafId === "string" && leafId) {
          try {
            const res = await conn.fork(leafId);
            if (!res?.cancelled) {
              const st = await conn.getState();
              const activeSessionId = st.activeSessionId ?? st.sessionId;
              return { activeSessionId };
            }
          } catch {
            // fall through to unsupported below
          }
        }
        throw rpcError(
          JSON_RPC_ERROR.methodNotFound,
          "cloneSession is not yet supported by the daemon",
        );
      }

      case "nameSession": {
        const p = requireParams<{ name: string }>(params, ["name"]);
        const conn = this.requireConn();
        await conn.setSessionName(p.name);
        return { name: p.name };
      }

      case "sideQuestion": {
        // The daemon's side-question flow requires a caller-generated id.
        const p = requireParams<{ text: string }>(params, ["text"]);
        const conn = this.requireConn();
        const id = `side-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
        await conn.startSideQuestion(id, p.text);
        return { id };
      }

      case "addSchedule": {
        const p = requireParams<{ cron: string; prompt: string }>(params, ["cron", "prompt"]);
        const conn = this.requireConn();
        const job = await conn.addCronJob(p.cron, p.prompt);
        return mapCronJobToSchedule(job as never);
      }

      case "removeSchedule": {
        const p = requireParams<{ id: string }>(params, ["id"]);
        const conn = this.requireConn();
        const job = await conn.cancelCronJob(p.id);
        return mapCronJobToSchedule(job as never);
      }

      case "setHeartbeat": {
        const p = requireParams<{ schedule: string; prompt?: string }>(params, ["schedule"]);
        const conn = this.requireConn();
        const job = await conn.setHeartbeat(p.schedule, p.prompt ?? "");
        return mapCronJobToSchedule(job as never);
      }

      case "removeHeartbeat": {
        // "clear" is the AgentHeartbeatUpdateAction that removes the heartbeat.
        const conn = this.requireConn();
        const job = await conn.updateHeartbeat("clear");
        return mapCronJobToSchedule(job as never);
      }

      case "navigateTree": {
        const p = requireParams<{ entryId: string }>(params, ["entryId"]);
        const conn = this.requireConn();
        return conn.navigateTree(p.entryId);
      }

      case "startSideQuestion": {
        // Alias of sideQuestion: the daemon requires a caller-generated id.
        const p = requireParams<{ text: string }>(params, ["text"]);
        const conn = this.requireConn();
        const id = `side-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
        await conn.startSideQuestion(id, p.text);
        return { id };
      }

      case "exportToHtml": {
        const p = optionalParams<{ outputPath?: string }>(params) ?? {};
        const conn = this.requireConn();
        const outputPath = await conn.exportToHtml(p.outputPath);
        return { outputPath };
      }

      case "exportToJsonl": {
        const p = optionalParams<{ outputPath?: string }>(params) ?? {};
        const conn = this.requireConn();
        const outputPath = await conn.exportToJsonl(p.outputPath);
        return { outputPath };
      }

      case "setSessionName": {
        const p = requireParams<{ name: string }>(params, ["name"]);
        const conn = this.requireConn();
        await conn.setSessionName(p.name);
        return { name: p.name };
      }

      case "getContextTree": {
        const conn = this.requireConn();
        const tree = await conn.getContextTree();
        return mapContextTree(tree as never);
      }

      default:
        throw rpcError(JSON_RPC_ERROR.methodNotFound, `unknown method: ${method}`);
    }
  }

  private statusForNoConnection(): ConnectionState["status"] {
    return { kind: this.holder.getStatus() };
  }

  private requireConn(): NonNullable<ReturnType<ConnectionHolder["getConnection"]>> {
    const conn = this.holder.getConnection();
    if (!conn) {
      throw rpcError(JSON_RPC_ERROR.internalError, "no active daemon connection");
    }
    return conn;
  }

  private async respondOk(id: string | number | null, result: unknown): Promise<void> {
    if (id === null) return; // notification; no response
    const payload: RpcResponse = { id, result: result ?? null };
    await this.writeLine(JSON.stringify(payload) + "\n");
  }

  private async respondError(
    id: string | number | null,
    code: number,
    message: string,
    data?: unknown,
  ): Promise<void> {
    if (id === null) return;
    const payload: RpcResponse = { id, error: { code, message, data } };
    await this.writeLine(JSON.stringify(payload) + "\n");
  }

  /** Serialize writes so NDJSON lines never interleave. */
  private async writeLine(line: string): Promise<void> {
    if (this.closed) return;
    this.writeChain = this.writeChain.then(
      () =>
        new Promise<void>((resolve, reject) => {
          this.stdout.write(line, (err) => {
            if (err) reject(err);
            else resolve();
          });
        }),
    );
    return this.writeChain;
  }

  private logError(message: string, err: unknown): void {
    const text = err instanceof Error ? `${message}: ${err.message}` : `${message}: ${String(err)}`;
    this.stderr.write(`[bridge] ${text}\n`);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function rpcError(code: number, message: string, data?: unknown): Error & { code: number; data?: unknown } {
  const e = new Error(message) as Error & { code: number; data?: unknown };
  e.code = code;
  if (data !== undefined) e.data = data;
  return e;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function requireParams<T extends Record<string, unknown>>(
  params: unknown,
  requiredKeys: readonly (keyof T)[],
): T {
  const obj = optionalParams<T>(params);
  if (!obj) throw rpcError(JSON_RPC_ERROR.invalidParams, "params required");
  for (const k of requiredKeys) {
    if (!(k in obj) || (obj as Record<string, unknown>)[k as string] === undefined) {
      throw rpcError(JSON_RPC_ERROR.invalidParams, `missing required param: ${String(k)}`);
    }
  }
  return obj;
}

function optionalParams<T extends Record<string, unknown>>(params: unknown): T | undefined {
  if (params === undefined || params === null) return undefined;
  if (!isPlainObject(params)) {
    throw rpcError(JSON_RPC_ERROR.invalidParams, "params must be an object");
  }
  return params as unknown as T;
}

function shellQuote(s: string): string {
  // POSIX-ish quoting: wrap in single quotes and escape embedded single quotes.
  return `'${s.replace(/'/g, `'\\''`)}'`;
}
