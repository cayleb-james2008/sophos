// profiles.test.ts — Code Mode in the profile system (v0.7.1). Verifies the
// 'code' profile + runtime mode are first-class in the same surface the header
// chip renders (PROFILES/MODES), that the composition composes the SDK tool
// set, and that the composition summary visibly changes for code mode while
// the existing Standard/Minimal/Creator summaries stay byte-identical.

import { describe, expect, it } from "vitest";
import {
  CODE_PROFILE,
  MODES,
  PROFILES,
  STANDARD_PROFILE,
  compositionFor,
  compositionSummary,
  profileById,
} from "../profiles";
import { CODE_MODE_TOOLS } from "../../code/toolRegistry";

describe("code profile", () => {
  it("is a first-class profile in the header chip list", () => {
    expect(PROFILES.map((p) => p.id)).toContain("code");
    expect(profileById("code")).toBe(CODE_PROFILE);
    expect(CODE_PROFILE.mode).toBe("code");
    expect(CODE_PROFILE.name).toBe("Code");
    expect(CODE_PROFILE.workingStyle).toContain("One program, many calls");
  });

  it("is selectable as a runtime mode alongside Standard/Minimal/Creator", () => {
    expect(MODES.map((m) => m.id)).toContain("code");
    const code = MODES.find((m) => m.id === "code");
    expect(code?.label).toBe("Code");
    // The existing three modes are untouched.
    expect(MODES.slice(0, 3).map((m) => m.id)).toEqual(["standard", "minimal", "creator"]);
  });

  it("composes the SDK tool set with a program-run confirmation", () => {
    const composition = compositionFor(CODE_PROFILE);
    expect(composition.mode).toBe("code");
    expect(composition.tools).toEqual(CODE_MODE_TOOLS);
    expect(composition.safety.autoApprove).toBe(false);
    expect(composition.safety.confirm).toEqual(["Program run"]);
  });
});

describe("compositionSummary", () => {
  it("visibly changes for code mode — the SDK note is present", () => {
    const summary = compositionSummary(compositionFor(CODE_PROFILE));
    expect(summary).toContain("SDK:");
    expect(summary).toContain(`${CODE_MODE_TOOLS.length} tools rendered as typed TypeScript stubs`);
    expect(summary).toContain("Tools:");
    expect(summary).toContain("Safety:");
  });

  it("leaves the existing mode summaries unchanged (no SDK note)", () => {
    const standard = compositionSummary(compositionFor(STANDARD_PROFILE));
    expect(standard).toContain("Tools: shell, file editor, file search, web search, kernel, refine");
    expect(standard).not.toContain("SDK:");
    const creator = compositionSummary(compositionFor({ ...STANDARD_PROFILE, mode: "creator" }));
    expect(creator).not.toContain("SDK:");
  });
});
