import { describe, expect, it } from "vitest";
import { sanitizeMockSettings } from "../mockClient";
import type { Settings } from "../contract";

/** Extension keys the mock persists alongside the typed Settings surface. */
function ext(out: Settings): Record<string, unknown> {
  return out as unknown as Record<string, unknown>;
}

describe("sanitizeMockSettings — demo-mode persisted settings", () => {
  it("drops a non-string defaultProvider (regression: crashed ProviderGlyph)", () => {
    const out = sanitizeMockSettings({ defaultProvider: { broken: "shape" } });
    expect(out).not.toHaveProperty("defaultProvider");
  });

  it("keeps valid string settings and drops invalid ones", () => {
    const out = sanitizeMockSettings({
      defaultProvider: "ollama-cloud",
      defaultModel: "deepseek-r1:8b",
      defaultThinking: 42,
      shellPath: 7,
      subagentDefaultProvider: "antares",
      subagentDefaultThinking: "medium",
      theme: "banana",
    });
    expect(out.defaultProvider).toBe("ollama-cloud");
    expect(out.defaultModel).toBe("deepseek-r1:8b");
    expect(out.subagentDefaultProvider).toBe("antares");
    expect(out.subagentDefaultThinking).toBe("medium");
    expect(out).not.toHaveProperty("defaultThinking");
    expect(out).not.toHaveProperty("shellPath");
    expect(out).not.toHaveProperty("theme");
  });

  it("accepts only the theme enum and real booleans", () => {
    expect(sanitizeMockSettings({ theme: "light" }).theme).toBe("light");
    expect(sanitizeMockSettings({ theme: "system" }).theme).toBe("system");
    expect(sanitizeMockSettings({ theme: "neon" })).not.toHaveProperty("theme");
    expect(sanitizeMockSettings({ daemonTcp: "yes" })).not.toHaveProperty("daemonTcp");
    expect(sanitizeMockSettings({ daemonTcp: true }).daemonTcp).toBe(true);
  });

  it("coerces arrays: drops non-array shapes and filters malformed entries", () => {
    const out = sanitizeMockSettings({
      disabledSkills: "not-an-array",
      mcpServers: {
        filesystem: { command: "npx", args: [] }, // non-array → dropped
      },
      customProfiles: { "not-an-array": { name: "X" } },
    });
    expect(out).not.toHaveProperty("disabledSkills");
    expect(out).not.toHaveProperty("mcpServers");
    expect(out).not.toHaveProperty("customProfiles");

    const good = sanitizeMockSettings({
      disabledSkills: ["skill-a", 42, null],
      mcpServers: [
        { name: "fs", command: "npx", args: ["-y", "x"], enabled: true },
        { name: 5, command: "bad" },
        { name: "missing-fields" },
      ],
      customProfiles: [{ name: "Review Bot" }, { name: 3 }, null],
    });
    expect(good.disabledSkills).toEqual(["skill-a"]);
    expect(ext(good).mcpServers).toEqual([{ name: "fs", command: "npx", args: ["-y", "x"], enabled: true }]);
    expect(ext(good).customProfiles).toEqual([{ name: "Review Bot" }]);
  });

  it("filters auth to non-empty strings and modelConfig to plain objects", () => {
    const out = sanitizeMockSettings({
      auth: { anthropic: "sk-123", empty: "", broken: { key: true } },
      modelConfig: { "p:m": { contextWindow: 128000 }, bad: "string", nullish: null },
    });
    expect(out.auth).toEqual({ anthropic: "sk-123" });
    expect(out.modelConfig).toEqual({ "p:m": { contextWindow: 128000 } });
  });

  it("drops unknown keys and non-object roots entirely", () => {
    expect(sanitizeMockSettings({ futureKey: { deep: [1, 2, 3] }, theme: "dark" }).theme).toBe("dark");
    expect(sanitizeMockSettings({ futureKey: { deep: [1, 2, 3] } })).not.toHaveProperty("futureKey");
    expect(sanitizeMockSettings(null)).toEqual({});
    expect(sanitizeMockSettings([1, 2, 3])).toEqual({});
    expect(sanitizeMockSettings("garbage")).toEqual({});
  });

  it("round-trips through localStorage without leaking garbage (regression: shared WebView2 profile)", () => {
    localStorage.setItem(
      "prime-agent.settings.v1",
      JSON.stringify({
        defaultProvider: { broken: "shape" },
        mcpServers: { filesystem: { command: "npx" } },
        theme: "dark",
        agentProfile: "gauntlet",
      }),
    );
    // Re-read through the same sanitizer the mock's readLocalSettings uses.
    const raw = localStorage.getItem("prime-agent.settings.v1");
    const out = sanitizeMockSettings(JSON.parse(raw!));
    const clean = { theme: "dark", agentProfile: "gauntlet" };
    expect(ext(out)).toEqual(clean);
    // Persisting the sanitized value keeps the store clean for the next launch.
    localStorage.setItem("prime-agent.settings.v1", JSON.stringify(out));
    expect(JSON.parse(localStorage.getItem("prime-agent.settings.v1")!)).toEqual(clean);
  });
});
