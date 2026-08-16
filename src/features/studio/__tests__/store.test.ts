// store.test.ts — the Profile Studio custom-profile store (v0.7.1). Verifies
// the guarded persistence contract: additive settings key, garbage-in → clean
// list out, validation, degradation to Standard defaults, id generation,
// system-prompt synthesis, composition, and the demo flavor that makes
// simulated responses follow the live draft.

import { describe, expect, it } from "vitest";
import { STANDARD_PROFILE, compositionFor, profileById } from "../../profiles/profiles";
import { CODE_MODE_TOOLS } from "../../code/toolRegistry";
import {
  CUSTOM_PROFILES_SETTINGS_KEY,
  buildCustomSystemPrompt,
  createCustomProfileDraft,
  customComposition,
  customDemoFlavor,
  isCustomId,
  isCustomProfileUsable,
  newCustomProfileId,
  parseCustomProfiles,
  sanitizeCustomProfile,
  type CustomProfile,
} from "../store";

function validProfile(overrides: Partial<CustomProfile> = {}): CustomProfile {
  return sanitizeCustomProfile({
    id: "custom-abc",
    name: "Builder Bot",
    tagline: "Compose fast, verify always",
    description: "A profile that composes tools from the live registry.",
    workingStyle: ["Goal first", "Verify with real runs"],
    mode: "creator",
    tools: ["shell", "web_search", "read_file"],
    skills: ["release-audit"],
    safety: { autoApprove: true, confirm: [] },
    ...overrides,
  });
}

describe("settings key + persistence shape", () => {
  it("persists under the additive customProfiles key", () => {
    expect(CUSTOM_PROFILES_SETTINGS_KEY).toBe("customProfiles");
  });

  it("round-trips through the sanitizer (load → save shape is stable)", () => {
    const p = validProfile();
    const reloaded = sanitizeCustomProfile(p);
    expect(reloaded).toEqual(p);
  });
});

describe("parseCustomProfiles — guarded parsing", () => {
  it("returns [] for non-array values (missing key, null, string, object)", () => {
    expect(parseCustomProfiles(undefined)).toEqual([]);
    expect(parseCustomProfiles(null)).toEqual([]);
    expect(parseCustomProfiles("nope")).toEqual([]);
    expect(parseCustomProfiles({ name: "x" })).toEqual([]);
    expect(parseCustomProfiles(42)).toEqual([]);
  });

  it("drops non-object junk and sanitizes real entries instead of throwing", () => {
    const parsed = parseCustomProfiles([null, 42, { id: "custom-1", name: "OK" }, "junk"]);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].id).toBe("custom-1");
    // A name-only entry is still well-formed (degrades only at activation).
    expect(parsed[0].name).toBe("OK");
    expect(parsed[0].tools).toEqual([]);
  });

  it("dedupes by id, keeping the first entry", () => {
    const parsed = parseCustomProfiles([
      { id: "custom-x", name: "First", tools: ["shell"] },
      { id: "custom-x", name: "Second", tools: ["shell"] },
    ]);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].name).toBe("First");
  });

  it("coerces malformed fields to safe defaults", () => {
    const p = sanitizeCustomProfile({ id: "custom-y", name: 42, tools: "shell", skills: [1, "ok"], safety: "nope", mode: "wat" });
    expect(p.name).toBe(""); // non-string name → empty (unusable, not crashing)
    expect(Array.isArray(p.tools)).toBe(true);
    // Garbage tools fall back to the built-in REGISTRY set — every default maps
    // 1:1 to a live-registry toggle in the studio.
    expect(p.tools).toEqual(CODE_MODE_TOOLS);
    expect(p.skills).toEqual(["ok"]);
    expect(p.safety).toEqual({ autoApprove: false, confirm: [] });
    expect(p.mode).toBe("standard");
  });
});

describe("validation + degradation", () => {
  it("a profile with a name and at least one tool is usable", () => {
    expect(isCustomProfileUsable(validProfile())).toBe(true);
  });

  it("an empty name is unusable", () => {
    expect(isCustomProfileUsable(validProfile({ name: "  " }))).toBe(false);
    expect(isCustomProfileUsable(validProfile({ name: "" }))).toBe(false);
  });

  it("an empty tool set is unusable", () => {
    expect(isCustomProfileUsable(validProfile({ tools: [] }))).toBe(false);
  });

  it("an unusable custom id degrades to Standard defaults through profileById", () => {
    // profileById doesn't know custom ids — it degrades to Standard.
    expect(profileById("custom-ghost")).toBe(STANDARD_PROFILE);
  });

  it("compositionFor uses the explicit custom composition when present", () => {
    const p = validProfile();
    const composition = compositionFor(p);
    expect(composition.tools).toEqual(p.tools);
    expect(composition.skills).toEqual(p.skills);
    expect(composition.safety).toEqual({ autoApprove: true, confirm: [] });
    expect(composition.mode).toBe("creator");
  });

  it("compositionFor leaves built-in compositions byte-identical", () => {
    const standard = compositionFor(STANDARD_PROFILE);
    expect(standard.tools).toEqual(["shell", "file editor", "file search", "web search", "kernel", "refine"]);
  });
});

describe("id generation + templates", () => {
  it("generates unique custom-prefixed ids", () => {
    const ids = new Set(Array.from({ length: 50 }, () => newCustomProfileId()));
    expect(ids.size).toBe(50);
    for (const id of ids) expect(id.startsWith("custom-")).toBe(true);
  });

  it("isCustomId distinguishes custom from built-in ids", () => {
    expect(isCustomId("custom-abc")).toBe(true);
    expect(isCustomId("gauntlet")).toBe(false);
    expect(isCustomId("standard")).toBe(false);
    expect(isCustomId("code")).toBe(false);
    expect(isCustomId("")).toBe(false);
  });

  it("createCustomProfileDraft seeds a usable Standard-style template", () => {
    const draft = createCustomProfileDraft({ mode: "creator" });
    expect(draft.id.startsWith("custom-")).toBe(true);
    expect(draft.mode).toBe("creator");
    expect(draft.tools.length).toBeGreaterThan(0);
    expect(draft.skills).toEqual([]);
    expect(draft.safety).toEqual({ autoApprove: false, confirm: [] });
  });

  it("a fresh draft's tools are the built-in REGISTRY names, so every default maps to a live toggle", () => {
    const draft = createCustomProfileDraft();
    expect(draft.tools).toEqual(CODE_MODE_TOOLS);
    // Every default tool must exist as a built-in registry entry — a display
    // name like "file editor" would never match a toggle.
    for (const tool of draft.tools) expect(tool).toMatch(/^[a-z_]+$/);
  });
});

describe("system prompt synthesis", () => {
  it("embeds name, tagline, working style, and a mode note", () => {
    const prompt = buildCustomSystemPrompt({ name: "Builder Bot", tagline: "Compose fast", workingStyle: ["Goal first", "Verify"], mode: "creator" });
    expect(prompt).toContain("Builder Bot");
    expect(prompt).toContain("Compose fast");
    expect(prompt).toContain("Goal first");
    expect(prompt).toContain("Creator mode");
    expect(prompt).toContain("Never invent evidence");
  });

  it("mentions the typed SDK for code-mode custom profiles", () => {
    const prompt = buildCustomSystemPrompt({ name: "SDK Composer", tagline: "", workingStyle: [], mode: "code" });
    expect(prompt).toContain("typed TypeScript SDK");
  });

  it("sanitize always re-synthesizes the prompt from the editable fields", () => {
    const p = sanitizeCustomProfile({ id: "custom-1", name: "X", tagline: "T", workingStyle: ["A"], mode: "minimal", systemPrompt: "stale" });
    expect(p.systemPrompt).not.toBe("stale");
    expect(p.systemPrompt).toContain("X");
    expect(p.systemPrompt).toContain("Minimal mode");
  });
});

describe("customComposition", () => {
  it("returns copies so callers can't mutate the stored profile", () => {
    const p = validProfile();
    const c = customComposition(p);
    c.tools.push("mutated");
    c.safety.confirm.push("mutated");
    expect(p.tools).not.toContain("mutated");
    expect(p.safety.confirm).not.toContain("mutated");
  });
});

describe("customDemoFlavor — demo follows the draft", () => {
  it("renders name, tagline, and working-style chips", () => {
    const flavor = customDemoFlavor({ name: "Builder Bot", tagline: "Compose fast", workingStyle: ["Goal first", "Verify with real runs"] });
    expect(flavor).toContain("Builder Bot");
    expect(flavor).toContain("Compose fast");
    expect(flavor).toContain("Goal first");
    expect(flavor).toContain("custom profile");
  });

  it("degrades to an empty block for a nameless (unusable) draft", () => {
    expect(customDemoFlavor({ name: "", tagline: "", workingStyle: [] })).toBe("");
    expect(customDemoFlavor(undefined)).toBe("");
  });
});
