// toolRegistry.test.ts — the Code Mode frontend tool registry. Verifies that
// the registry is assembled from the existing runtime-info calls (built-ins +
// extension/MCP tools + skills), sorted lexicographically, deduped, and that
// missing/unavailable sources degrade instead of throwing.

import { describe, expect, it } from "vitest";
import {
  BUILTIN_TOOLS,
  CODE_MODE_TOOLS,
  assembleRegistry,
  countByCategory,
  sortEntries,
  type RegistrySources,
  type ToolRegistryEntry,
} from "../toolRegistry";

function sources(overrides: Partial<RegistrySources> = {}): RegistrySources {
  return {
    runtime: {
      cwd: "C:\\work\\sophos",
      kernel: { status: "configured", persistent: true, toolAvailable: true },
      skills: [
        { name: "release-audit", description: "Audit a release artifact", source: "project" },
        { name: "code-review", description: "Review code for quality", source: "global" },
      ],
      skillDiagnostics: [],
      extensions: ["~/.pi/agent/extensions/github-integration"],
    },
    extensions: [
      { name: "github-integration", path: "x", enabled: true, tools: [{ name: "create_issue", description: "Create a GitHub issue" }, { name: "list_prs", description: "List open pull requests" }], slashCommands: [] },
    ],
    mcpServers: [
      { name: "filesystem", command: "npx", args: ["-y", "server-filesystem"], enabled: true },
      { name: "disabled-server", command: "npx", args: [], enabled: false },
    ],
    mcpResults: {
      filesystem: { serverName: "filesystem", connected: true, latencyMs: 42, tools: ["search", "fetch"] },
    },
    ...overrides,
  };
}

describe("assembleRegistry", () => {
  it("includes built-ins plus extension/MCP tools and skills from runtime sources", () => {
    const registry = assembleRegistry(sources());
    const names = registry.map((e) => e.name);

    // Built-ins present.
    for (const tool of BUILTIN_TOOLS) expect(names).toContain(tool.name);
    // Extension tools.
    expect(names).toContain("create_issue");
    expect(names).toContain("list_prs");
    // MCP tools from the enabled (connected) server only.
    expect(names).toContain("search");
    expect(names).toContain("fetch");
    // Skills from the runtime info.
    expect(names).toContain("release-audit");
    expect(names).toContain("code-review");
  });

  it("skips disabled and unconnected MCP servers", () => {
    const registry = assembleRegistry(
      sources({ mcpServers: [{ name: "off", command: "npx", enabled: false }] }),
    );
    expect(registry.some((e) => e.source === "off")).toBe(false);

    const disconnected = assembleRegistry(
      sources({
        mcpServers: [{ name: "down", command: "npx", enabled: true }],
        mcpResults: { down: { serverName: "down", connected: false, error: "refused" } },
      }),
    );
    expect(disconnected.some((e) => e.source === "down")).toBe(false);
  });

  it("orders entries lexicographically by name", () => {
    const registry = assembleRegistry(sources());
    const names = registry.map((e) => e.name);
    const sorted = [...names].sort();
    expect(names).toEqual(sorted);
    // And the pure sorter is stable on a shuffled copy.
    const shuffled = [...registry].reverse();
    expect(sortEntries(shuffled).map((e) => e.name)).toEqual(sorted);
  });

  it("dedupes by name with built-ins winning", () => {
    const registry = assembleRegistry(
      sources({
        extensions: [{ name: "web", path: "x", enabled: true, tools: [{ name: "web_search", description: "extension copy" }], slashCommands: [] }],
      }),
    );
    const webSearch = registry.find((e) => e.name === "web_search");
    expect(webSearch?.category).toBe("builtin");
    expect(registry.filter((e) => e.name === "web_search")).toHaveLength(1);
  });

  it("degrades gracefully when sources are null or missing", () => {
    const registry = assembleRegistry({ runtime: null, extensions: null, mcpServers: null, mcpResults: {} });
    // Built-ins always present — the SDK section can always render.
    expect(registry.length).toBe(BUILTIN_TOOLS.length);
    expect(assembleRegistry({ runtime: null, extensions: null, mcpServers: [], mcpResults: {} })).toHaveLength(BUILTIN_TOOLS.length);
  });

  it("counts per category deterministically", () => {
    const counts = countByCategory(assembleRegistry(sources()));
    expect(counts.builtin).toBe(BUILTIN_TOOLS.length);
    expect(counts.extension).toBe(2);
    expect(counts.mcp).toBe(2);
    expect(counts.skill).toBe(2);
  });
});

describe("CODE_MODE_TOOLS", () => {
  it("mirrors the built-in registry so the profile composition can't drift", () => {
    expect(CODE_MODE_TOOLS).toEqual(BUILTIN_TOOLS.map((t) => t.name));
    expect(CODE_MODE_TOOLS.length).toBeGreaterThanOrEqual(4);
  });
});

describe("malformed registry entries", () => {
  it("carries entries without a schema (the renderer degrades, never throws)", () => {
    const weird: ToolRegistryEntry = { name: "mystery_tool", category: "extension", source: "x" };
    const registry = assembleRegistry({
      runtime: null,
      extensions: [{ name: "x", path: "p", enabled: true, tools: [{ name: "mystery_tool" }], slashCommands: [] }],
      mcpServers: null,
      mcpResults: {},
    });
    expect(registry.some((e) => e.name === "mystery_tool" && !e.schema)).toBe(true);
    expect(registry.some((e) => e.name === "mystery_tool" && e.category === "extension")).toBe(true);
    expect(weird).toBeDefined();
  });
});
