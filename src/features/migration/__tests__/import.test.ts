// Unit tests for the migration parsers. These are pure/node-safe (no DOM), and
// every assertion verifies the mapping is correct AND that malformed input never
// throws.

import { describe, it, expect } from "vitest";
import {
  parseClaudeMd,
  parseClaudeConfig,
  parseCodexConfig,
  mergeImportResults,
  type ImportResult,
} from "../import";

describe("parseClaudeMd", () => {
  it("extracts the trimmed instruction body from a CLAUDE.md", () => {
    const { instructions, notes } = parseClaudeMd("  You are a careful engineer.  ");
    expect(instructions).toBe("You are a careful engineer.");
    expect(notes).toEqual([]);
  });

  it("reports (does not throw) on empty input", () => {
    const { instructions, notes } = parseClaudeMd("");
    expect(instructions).toBe("");
    expect(notes.length).toBeGreaterThan(0);
  });
});

describe("parseClaudeConfig", () => {
  const sample = {
    model: "claude-opus-4-20250514",
    auth: { anthropic: "sk-ant-test" },
    mcpServers: {
      github: { command: "npx", args: ["-y", "@modelcontextprotocol/server-github"] },
    },
    hooks: { PostToolUse: [] },
  };

  it("maps model, auth, and mcpServers and notes hooks honestly", () => {
    const r = parseClaudeConfig(sample);
    expect(r.settingsPatch.defaultModel).toBe("claude-opus-4-20250514");
    expect(r.settingsPatch.auth).toEqual({ anthropic: "sk-ant-test" });
    expect(r.settingsPatch.mcpServers).toEqual([
      { name: "github", command: "npx", args: ["-y", "@modelcontextprotocol/server-github"], enabled: true },
    ]);
    expect(r.notes.some((n) => n.toLowerCase().includes("hooks") && n.includes("NOT imported"))).toBe(true);
    expect(r.suggestedProfile.name).toContain("Claude Desktop");
  });

  it("preserves server environment values without carrying foreign types", () => {
    const result = parseClaudeConfig({
      mcpServers: { db: { command: "node", env: { DATABASE_URL: "local-fixture", RETRIES: 3 } } },
    });
    expect(result.settingsPatch.mcpServers?.[0].env).toEqual({ DATABASE_URL: "local-fixture" });
    expect(result.notes.join(" ")).toContain("activation requires a supported MCP runtime");
  });

  it("splits a provider/model form", () => {
    const r = parseClaudeConfig({ model: "anthropic/claude-3-5-sonnet" });
    expect(r.settingsPatch.defaultProvider).toBe("anthropic");
    expect(r.settingsPatch.defaultModel).toBe("claude-3-5-sonnet");
  });

  it("skips non-string auth values instead of throwing", () => {
    const r = parseClaudeConfig({ auth: { anthropic: { nested: true } } });
    expect(r.settingsPatch.auth).toBeUndefined();
    expect(r.notes.length).toBeGreaterThan(0);
  });

  it("never throws on foreign / non-object input", () => {
    expect(() => parseClaudeConfig("not an object")).not.toThrow();
    expect(() => parseClaudeConfig(null)).not.toThrow();
    const r = parseClaudeConfig("garbage");
    expect(r.settingsPatch).toEqual({});
    expect(r.notes.length).toBeGreaterThan(0);
  });
});

describe("parseCodexConfig (JSON)", () => {
  const json = JSON.stringify({
    model: "gpt-4o",
    approvalPolicy: "on-request",
    providers: { openai: { apiKey: "sk-codex-json" } },
    mcpServers: [{ name: "fs", command: "npx", args: ["-y", "x"] }],
  });

  it("parses JSON, maps model/auth/mcp, and notes approval policy", () => {
    const r = parseCodexConfig(json);
    expect(r.settingsPatch.defaultModel).toBe("gpt-4o");
    expect(r.settingsPatch.auth).toEqual({ openai: "sk-codex-json" });
    expect(r.settingsPatch.mcpServers).toEqual([
      { name: "fs", command: "npx", args: ["-y", "x"], enabled: true },
    ]);
    expect(r.notes.some((n) => n.includes("approval policy") && n.includes("NOT auto-applied"))).toBe(true);
  });

  it("never throws on invalid JSON", () => {
    expect(() => parseCodexConfig("{not json")).not.toThrow();
    const r = parseCodexConfig("{not json");
    expect(r.settingsPatch).toEqual({});
    expect(r.notes.some((n) => n.includes("could not be parsed"))).toBe(true);
  });
});

describe("parseCodexConfig (TOML)", () => {
  const toml = `model = "gpt-4o"
approval_policy = "on-request"

[auth]
openai = "sk-codex-test"

[mcpServers.fs]
command = "npx"
args = ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"]
`;

  it("parses minimal TOML into the same shape as JSON", () => {
    const r = parseCodexConfig(toml);
    expect(r.settingsPatch.defaultModel).toBe("gpt-4o");
    expect(r.settingsPatch.auth).toEqual({ openai: "sk-codex-test" });
    expect(r.settingsPatch.mcpServers).toEqual([
      {
        name: "fs",
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"],
        enabled: true,
      },
    ]);
    expect(r.notes.some((n) => n.includes("approval policy"))).toBe(true);
  });

  it("never throws on unparseable TOML", () => {
    expect(() => parseCodexConfig("model = ")).not.toThrow();
    const r = parseCodexConfig("model = ");
    expect(r.settingsPatch).toEqual({});
  });
});

describe("mergeImportResults", () => {
  it("merges model (later wins), unions auth, concatenates mcp, collects notes", () => {
    const a: ImportResult = parseClaudeConfig({
      model: "claude-x",
      auth: { a: "1" },
      mcpServers: { m1: { command: "c" } },
    });
    const b: ImportResult = parseCodexConfig(
      JSON.stringify({ model: "gpt-4o", auth: { b: "2" }, mcpServers: [{ name: "m2", command: "c2" }] }),
    );
    const merged = mergeImportResults([a, b]);
    expect(merged.settingsPatch.defaultModel).toBe("gpt-4o"); // later wins
    expect(merged.settingsPatch.auth).toEqual({ a: "1", b: "2" });
    expect(merged.settingsPatch.mcpServers?.length).toBe(2);
    expect(merged.notes.length).toBeGreaterThan(a.notes.length + b.notes.length - 1);
  });

  it("returns a safe default for an empty input list", () => {
    const merged = mergeImportResults([]);
    expect(merged.settingsPatch).toEqual({});
    expect(merged.suggestedProfile.name).toContain("Claude / Codex");
  });
});
