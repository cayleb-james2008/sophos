// editor.test.ts — the Profile Studio editor reducer (v0.7.1). Verifies every
// action mutates the draft immutably, the working-style text parses into
// chips, tool/skill toggles compose, the safety posture edits, and the live
// composition summary updates with every toggle — the state the running app
// hot-reloads from.

import { describe, expect, it } from "vitest";
import {
  freshDraft,
  studioCompositionSummary,
  studioReducer,
  workingStyleFromText,
  workingStyleToText,
} from "../editor";
import { sanitizeCustomProfile, type CustomProfile } from "../store";

function draft(overrides: Partial<CustomProfile> = {}): CustomProfile {
  return sanitizeCustomProfile({
    id: "custom-abc",
    name: "Builder Bot",
    tagline: "Compose fast",
    description: "",
    workingStyle: ["Goal first"],
    mode: "creator",
    tools: ["shell", "web_search"],
    skills: [],
    safety: { autoApprove: true, confirm: [] },
    ...overrides,
  });
}

describe("working style parsing", () => {
  it("splits lines and commas into deduped chips", () => {
    expect(workingStyleFromText("Goal first\nVerify\nGoal first")).toEqual(["Goal first", "Verify"]);
    expect(workingStyleFromText("a, b, c")).toEqual(["a", "b", "c"]);
    expect(workingStyleFromText("   \n  \n")).toEqual([]);
  });

  it("round-trips chips → text → chips", () => {
    const chips = ["Goal first", "Verify with real runs"];
    expect(workingStyleFromText(workingStyleToText(chips))).toEqual(chips);
  });
});

describe("studioReducer", () => {
  it("edits identity fields immutably", () => {
    const d = draft();
    const next = studioReducer(studioReducer(studioReducer(d, { type: "name", value: "Renamed" }), { type: "tagline", value: "New tagline" }), { type: "description", value: "New desc" });
    expect(d.name).toBe("Builder Bot");
    expect(next.name).toBe("Renamed");
    expect(next.tagline).toBe("New tagline");
    expect(next.description).toBe("New desc");
    expect(next).not.toBe(d);
  });

  it("parses working-style text into chips", () => {
    const next = studioReducer(draft(), { type: "workingStyleText", value: "A\nB" });
    expect(next.workingStyle).toEqual(["A", "B"]);
  });

  it("toggles tools on and off", () => {
    const d = draft();
    const on = studioReducer(d, { type: "toggleTool", name: "read_file" });
    expect(on.tools).toContain("read_file");
    expect(on.tools).toHaveLength(3);
    const off = studioReducer(on, { type: "toggleTool", name: "read_file" });
    expect(off.tools).not.toContain("read_file");
    expect(off.tools).toEqual(d.tools);
    expect(on).not.toBe(d);
  });

  it("toggles skills on and off without touching tools", () => {
    const on = studioReducer(draft(), { type: "toggleSkill", name: "release-audit" });
    expect(on.skills).toEqual(["release-audit"]);
    expect(on.tools).toEqual(draft().tools);
    const off = studioReducer(on, { type: "toggleSkill", name: "release-audit" });
    expect(off.skills).toEqual([]);
  });

  it("changes the base mode", () => {
    const next = studioReducer(draft(), { type: "mode", value: "minimal" });
    expect(next.mode).toBe("minimal");
  });

  it("toggles the auto-approve safety posture", () => {
    const d = draft();
    const next = studioReducer(d, { type: "setAutoApprove", value: false });
    expect(next.safety.autoApprove).toBe(false);
    expect(d.safety.autoApprove).toBe(true);
  });

  it("adds confirm entries (deduped, trimmed, empty ignored)", () => {
    const a = studioReducer(draft({ safety: { autoApprove: false, confirm: ["Destructive shell"] } }), { type: "confirmAdd", value: "  Network write  " });
    expect(a.safety.confirm).toEqual(["Destructive shell", "Network write"]);
    const dup = studioReducer(a, { type: "confirmAdd", value: "Network write" });
    expect(dup.safety.confirm).toHaveLength(2);
    const blank = studioReducer(a, { type: "confirmAdd", value: "   " });
    expect(blank.safety.confirm).toHaveLength(2);
  });

  it("removes confirm entries", () => {
    const next = studioReducer(draft({ safety: { autoApprove: false, confirm: ["Destructive shell", "Network write"] } }), { type: "confirmRemove", value: "Network write" });
    expect(next.safety.confirm).toEqual(["Destructive shell"]);
  });

  it("reset replaces the whole draft (Discard / open-edit)", () => {
    const original = draft();
    const edited = studioReducer(original, { type: "name", value: "Changed" });
    const reset = studioReducer(edited, { type: "reset", profile: original });
    expect(reset).toEqual(original);
  });

  it("freshDraft always produces a usable, independent template", () => {
    const a = freshDraft("minimal");
    const b = freshDraft("minimal");
    expect(a.id).not.toBe(b.id);
    expect(a.mode).toBe("minimal");
    expect(a.tools.length).toBeGreaterThan(0);
  });
});

describe("live composition summary", () => {
  it("reflects tools, skills, and safety posture", () => {
    const summary = studioCompositionSummary(draft({ skills: ["release-audit"], safety: { autoApprove: true, confirm: [] } }));
    expect(summary).toContain("Tools: shell, web_search");
    expect(summary).toContain("Skills: release-audit");
    expect(summary).toContain("safe tools auto-approved");
  });

  it("updates when a toggle flips (hot-reload state)", () => {
    const d = draft();
    const before = studioCompositionSummary(d);
    const after = studioCompositionSummary(studioReducer(d, { type: "toggleTool", name: "read_file" }));
    expect(after).not.toBe(before);
    expect(after).toContain("read_file");
    expect(before).not.toContain("read_file");
  });

  it("shows the confirm list when not auto-approving", () => {
    const summary = studioCompositionSummary(draft({ safety: { autoApprove: false, confirm: ["Destructive shell"] } }));
    expect(summary).toContain("confirms: Destructive shell");
  });
});
