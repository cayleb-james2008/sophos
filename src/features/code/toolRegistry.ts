// toolRegistry — the Code Mode frontend tool registry (v0.7.1).
//
// Code Mode exposes the agent's tools through a TypeScript SDK: one program
// calls many tools in a single step. The SDK renders deterministically from
// THIS registry, which is assembled from the same sources the rest of the app
// already uses — no new daemon contract:
//
//   built-in  — the static tool set (mirrors MODE_TOOLS.code in profiles)
//   extension — tools registered by installed extensions (getExtensions)
//   mcp       — tools reported by enabled MCP servers (settings.mcpServers
//               probed through testMcpServer)
//   skill     — skills discovered by the live runtime (getRuntimeInfo)
//
// Assembly is deterministic: entries are deduped by name (built-ins win) and
// sorted lexicographically by name, so an unchanged tool set always renders
// byte-identical SDK output.

import type { ExtensionInfo, McpTestResult, RuntimeInfo, Settings } from "../../ipc/contract";
import type { IpcClient } from "../../ipc/client";

/** Where a registry entry came from — drives the SDK stub comment + badges. */
export type ToolCategory = "builtin" | "extension" | "mcp" | "skill";

/** A single parameter declaration in a tool's schema (JSON-schema-ish). */
export interface ParamSpec {
  type?: string;
  description?: string;
  enum?: unknown[];
  items?: { type?: string };
}

/** A tool's argument contract. Anything the renderer can't map degrades. */
export interface ToolSchema {
  type?: string;
  properties?: Record<string, ParamSpec>;
  required?: string[];
}

/** One tool in the registry. `schema` may be absent — the SDK renderer
 * degrades to an untyped `Record<string, unknown>` contract instead of
 * throwing, so an unknown tool never breaks the SDK surface. */
export interface ToolRegistryEntry {
  name: string;
  description?: string;
  category: ToolCategory;
  /** Origin detail: extension name, MCP server name, or skill source. */
  source?: string;
  schema?: ToolSchema;
}

/** An MCP server as persisted in settings (`mcpServers` additive field). */
export interface McpServerConfig {
  name: string;
  command: string;
  args?: string[];
  enabled: boolean;
}

// ---------------------------------------------------------------------------
// Built-in tools — the static core of the registry. Names mirror
// MODE_TOOLS.code in profiles.ts (CODE_MODE_TOOLS is derived from this list).
// ---------------------------------------------------------------------------

export const BUILTIN_TOOLS: ToolRegistryEntry[] = [
  {
    name: "shell",
    description: "Run a shell command in the session workspace.",
    category: "builtin",
    schema: {
      type: "object",
      properties: {
        command: { type: "string", description: "The command to execute" },
        cwd: { type: "string", description: "Working directory (defaults to the session cwd)" },
      },
      required: ["command"],
    },
  },
  {
    name: "read_file",
    description: "Read a file from the session workspace.",
    category: "builtin",
    schema: {
      type: "object",
      properties: { path: { type: "string", description: "Path of the file to read" } },
      required: ["path"],
    },
  },
  {
    name: "edit_file",
    description: "Edit a file with an old/new string replacement.",
    category: "builtin",
    schema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Path of the file to edit" },
        old_string: { type: "string", description: "Exact text to replace" },
        new_string: { type: "string", description: "Replacement text" },
      },
      required: ["path", "old_string"],
    },
  },
  {
    name: "search_files",
    description: "Search files in the session workspace by pattern.",
    category: "builtin",
    schema: {
      type: "object",
      properties: {
        pattern: { type: "string", description: "Search pattern (regex)" },
        path: { type: "string", description: "Subdirectory to search (defaults to the session cwd)" },
      },
      required: ["pattern"],
    },
  },
  {
    name: "web_search",
    description: "Search the web for current information.",
    category: "builtin",
    schema: {
      type: "object",
      properties: { query: { type: "string", description: "Search query" } },
      required: ["query"],
    },
  },
  {
    name: "run_cell",
    description: "Run a code cell in the persistent kernel.",
    category: "builtin",
    schema: {
      type: "object",
      properties: { code: { type: "string", description: "Cell source" } },
      required: ["code"],
    },
  },
  {
    name: "refine",
    description: "Refine the session's goal and plan.",
    category: "builtin",
    schema: {
      type: "object",
      properties: { prompt: { type: "string", description: "Optional refinement direction" } },
    },
  },
  {
    name: "inspect_runtime",
    description: "Inspect live runtime capabilities (kernel, skills, extensions).",
    category: "builtin",
    schema: { type: "object", properties: {} },
  },
  {
    name: "ast_grep_search",
    description: "Structural AST pattern search ignoring formatting and whitespace (ast-grep).",
    category: "builtin",
    schema: {
      type: "object",
      properties: {
        pattern: { type: "string", description: "AST syntax pattern to match" },
        lang: { type: "string", description: "Language (typescript, rust, python, etc.)" },
        path: { type: "string", description: "Target subdirectory or file" },
      },
      required: ["pattern"],
    },
  },
  {
    name: "ast_grep_outline",
    description: "Extract symbols, functions, and exports from a file with AST parsing.",
    category: "builtin",
    schema: {
      type: "object",
      properties: {
        path: { type: "string", description: "File path to outline" },
        lang: { type: "string", description: "Language identifier" },
      },
      required: ["path"],
    },
  },
  {
    name: "repomix_pack",
    description: "Pack token-budgeted directory context with Tree-Sitter compression (repomix).",
    category: "builtin",
    schema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Root path to pack" },
        token_budget: { type: "number", description: "Strict token budget limit" },
        compress: { type: "boolean", description: "Enable Tree-Sitter signature compression" },
      },
    },
  },
  {
    name: "code_repo_map",
    description: "Generate high-level call-graph and structural dependency map for the codebase.",
    category: "builtin",
    schema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Base path of repository" },
        max_tokens: { type: "number", description: "Maximum token budget for the map" },
      },
    },
  },
  {
    name: "memory_search",
    description: "Semantic search across OpenViking / Letta multi-tier memory.",
    category: "builtin",
    schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Semantic search query" },
        tier: { type: "string", description: "Target tier: working | recall | archival" },
      },
      required: ["query"],
    },
  },
  {
    name: "memory_store",
    description: "Store a durable fact with bi-temporal validity tags into memory.",
    category: "builtin",
    schema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Fact summary title" },
        content: { type: "string", description: "Detailed fact content" },
        tier: { type: "string", description: "Storage tier: working | recall | archival" },
        uri: { type: "string", description: "Optional viking:// URI identifier" },
      },
      required: ["title", "content"],
    },
  },
  {
    name: "memory_recall",
    description: "Recall high-confidence facts and active scratchpad entries.",
    category: "builtin",
    schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Lookup query" },
        limit: { type: "number", description: "Max entries to return" },
      },
      required: ["query"],
    },
  },
  {
    name: "memory_forget",
    description: "Invalidate or prune an outdated memory entry.",
    category: "builtin",
    schema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Memory entry ID to invalidate" },
      },
      required: ["id"],
    },
  },
  {
    name: "create_checkpoint",
    description: "Create a durable session state checkpoint before risky actions or multi-turn loops.",
    category: "builtin",
    schema: {
      type: "object",
      properties: {
        label: { type: "string", description: "Human-readable checkpoint label" },
        summary: { type: "string", description: "Description of state delta" },
      },
      required: ["label"],
    },
  },
  {
    name: "restore_checkpoint",
    description: "Roll back workspace and session state to a saved checkpoint.",
    category: "builtin",
    schema: {
      type: "object",
      properties: {
        checkpoint_id: { type: "string", description: "ID of checkpoint to restore" },
      },
      required: ["checkpoint_id"],
    },
  },
];

/** The tool names Code mode composes (derived so profiles can't drift). */
export const CODE_MODE_TOOLS: string[] = BUILTIN_TOOLS.map((t) => t.name);

// ---------------------------------------------------------------------------
// Assembly — deterministic merge of the runtime sources
// ---------------------------------------------------------------------------

export interface RegistrySources {
  runtime: RuntimeInfo | null;
  extensions: ExtensionInfo[] | null;
  mcpServers: McpServerConfig[] | null;
  /** testMcpServer results keyed by server name (only connected servers contribute). */
  mcpResults: Record<string, McpTestResult>;
}

/** Lexicographic order by name, then category for a stable tiebreak. Pure —
 * sorting a copy never mutates the caller's array. */
export function sortEntries(entries: ToolRegistryEntry[]): ToolRegistryEntry[] {
  return [...entries].sort((a, b) =>
    a.name < b.name
      ? -1
      : a.name > b.name
        ? 1
        : a.category < b.category
          ? -1
          : a.category > b.category
            ? 1
            : 0,
  );
}

/**
 * Assemble the registry from live runtime sources. Deterministic: dedupe by
 * name (built-ins win, then extension/MCP/skill in source order), then sort
 * lexicographically. Degrades gracefully — null/empty sources contribute
 * nothing rather than throwing.
 */
export function assembleRegistry(sources: RegistrySources): ToolRegistryEntry[] {
  const entries: ToolRegistryEntry[] = [];
  const seen = new Set<string>();
  const push = (entry: ToolRegistryEntry) => {
    if (seen.has(entry.name)) return;
    seen.add(entry.name);
    entries.push(entry);
  };

  for (const tool of BUILTIN_TOOLS) push(tool);

  for (const ext of sources.extensions ?? []) {
    for (const tool of ext.tools ?? []) {
      push({ name: tool.name, description: tool.description, category: "extension", source: ext.name });
    }
  }

  for (const server of sources.mcpServers ?? []) {
    if (!server.enabled) continue;
    const result = sources.mcpResults[server.name];
    if (!result?.connected) continue;
    for (const tool of result.tools ?? []) {
      push({ name: tool, description: `MCP tool from ${server.name}`, category: "mcp", source: server.name });
    }
  }

  for (const skill of sources.runtime?.skills ?? []) {
    push({ name: skill.name, description: skill.description, category: "skill", source: skill.source });
  }

  return sortEntries(entries);
}

/** Per-category counts for the SDK header + panel stats. Deterministic. */
export function countByCategory(entries: ToolRegistryEntry[]): Record<ToolCategory, number> {
  const counts: Record<ToolCategory, number> = { builtin: 0, extension: 0, mcp: 0, skill: 0 };
  for (const entry of entries) counts[entry.category] += 1;
  return counts;
}

/** Read the persisted MCP server list from settings (additive field). */
function readMcpServers(settings: Settings | null): McpServerConfig[] {
  const raw = (settings as (Settings & { mcpServers?: McpServerConfig[] }) | null)?.mcpServers;
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (s): s is McpServerConfig => !!s && typeof s.name === "string" && typeof s.command === "string",
  );
}

/**
 * Load the live registry from the IPC client. Uses only existing calls:
 * getRuntimeInfo, getExtensions, getSettings, testMcpServer. Any failure in a
 * source degrades to that source contributing nothing — the SDK section
 * always renders (the bar: unsupported sources degrade, never throw).
 */
export async function loadToolRegistry(client: IpcClient, settings?: Settings): Promise<ToolRegistryEntry[]> {
  const [runtime, extensions, s] = await Promise.all([
    client.getRuntimeInfo().catch(() => null),
    typeof client.getExtensions === "function"
      ? client.getExtensions().catch(() => null)
      : Promise.resolve(null),
    settings
      ? Promise.resolve(settings)
      : typeof client.getSettings === "function"
        ? client.getSettings().catch(() => null)
        : Promise.resolve(null),
  ]);

  const servers = readMcpServers(s);
  const enabled = servers.filter((server) => server.enabled);
  const mcpResults: Record<string, McpTestResult> = {};
  await Promise.all(
    enabled.map(async (server) => {
      try {
        mcpResults[server.name] = await client.testMcpServer(server.name, server.command, server.args);
      } catch {
        mcpResults[server.name] = { serverName: server.name, connected: false };
      }
    }),
  );

  return assembleRegistry({ runtime, extensions, mcpServers: enabled, mcpResults });
}
