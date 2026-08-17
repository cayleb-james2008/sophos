// portable.test.ts — the Profile Studio's portability half (v0.7.1): export a
// custom profile to a human-readable JSON file, import it back (guarded parse),
// and merge it into the live store without ever silently overwriting a name or
// id. Covers serialize / parse / merge / round-trip plus the honest degrade of
// the file-I/O layer where no native or browser file API exists.

import { describe, expect, it } from "vitest";
import { describeImportOutcome, type CustomProfileImportResult } from "../../profiles/profiles";
import { CODE_MODE_TOOLS } from "../../code/toolRegistry";
import { sanitizeCustomProfile, type CustomProfile } from "../store";
import {
  PROFILE_FILE_FORMAT,
  PROFILE_FILE_VERSION,
  exportProfileToFile,
  importProfileFromFile,
  mergeImportedProfile,
  parseCustomProfileFile,
  serializeCustomProfile,
  suggestProfileFileName,
} from "../portable";

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

describe("serializeCustomProfile — the human-readable file format", () => {
  it("writes an envelope with format + version + the canonical profile", () => {
    const text = serializeCustomProfile(validProfile());
    const parsed = JSON.parse(text) as Record<string, unknown>;
    expect(parsed.format).toBe(PROFILE_FILE_FORMAT);
    expect(parsed.version).toBe(PROFILE_FILE_VERSION);
    expect(typeof parsed.exportedAt).toBe("string");
    const p = parsed.profile as Record<string, unknown>;
    expect(p.name).toBe("Builder Bot");
    expect(p.tagline).toBe("Compose fast, verify always");
    expect(p.workingStyle).toEqual(["Goal first", "Verify with real runs"]);
    expect(p.mode).toBe("creator");
    expect(p.tools).toEqual(["shell", "web_search", "read_file"]);
    expect(p.skills).toEqual(["release-audit"]);
    expect(p.safety).toEqual({ autoApprove: true, confirm: [] });
  });

  it("is pretty-printed and human-readable (indented, not minified)", () => {
    const text = serializeCustomProfile(validProfile());
    expect(text).toContain("\n  \"format\":");
    expect(text).not.toContain('{"format"');
  });

  it("sanitizes before writing — a malformed in-memory profile can't leak into the file", () => {
    const text = serializeCustomProfile({ ...validProfile(), tools: ["shell"] as unknown as string[] });
    const parsed = JSON.parse(text) as { profile: CustomProfile };
    expect(Array.isArray(parsed.profile.tools)).toBe(true);
  });

  it("suggests a clean, shareable file name", () => {
    expect(suggestProfileFileName(validProfile({ name: "My Builder!" }))).toBe("my-builder.sophos-profile.json");
    expect(suggestProfileFileName(validProfile({ name: "   " }))).toBe("custom-profile.sophos-profile.json");
  });
});

describe("parseCustomProfileFile — guarded parsing", () => {
  it("round-trips the envelope (serialize → parse → identical profile)", () => {
    const original = validProfile();
    const parsed = parseCustomProfileFile(serializeCustomProfile(original));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.profile).toEqual(original);
  });

  it("accepts a bare profile object (hand-edited files)", () => {
    const parsed = parseCustomProfileFile(JSON.stringify(validProfile({ name: "Bare" })));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.profile.name).toBe("Bare");
  });

  it("rejects empty text", () => {
    expect(parseCustomProfileFile("")).toMatchObject({ ok: false, error: expect.stringContaining("empty") });
    expect(parseCustomProfileFile("   \n  ")).toMatchObject({ ok: false });
  });

  it("rejects malformed JSON with a clear error and never throws", () => {
    expect(parseCustomProfileFile("{ not json !!")).toMatchObject({ ok: false, error: expect.stringContaining("not valid JSON") });
    expect(parseCustomProfileFile("undefined")).toMatchObject({ ok: false });
  });

  it("rejects non-object top-level values", () => {
    for (const v of ["[1,2,3]", "42", '"str"', "null"]) {
      expect(parseCustomProfileFile(v).ok).toBe(false);
    }
  });

  it("rejects a future file version with an explicit message", () => {
    const text = serializeCustomProfile(validProfile()).replace(`"version": ${PROFILE_FILE_VERSION}`, `"version": ${PROFILE_FILE_VERSION + 99}`);
    const parsed = parseCustomProfileFile(text);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.error).toContain("version");
  });

  it("rejects an envelope with no profile object", () => {
    expect(parseCustomProfileFile(JSON.stringify({ format: PROFILE_FILE_FORMAT, version: PROFILE_FILE_VERSION }))).toMatchObject({
      ok: false,
      error: expect.stringContaining("no profile object"),
    });
  });

  it("rejects a foreign envelope instead of guessing", () => {
    expect(parseCustomProfileFile(JSON.stringify({ format: "other-app", profile: { name: "X" } }))).toMatchObject({
      ok: false,
      error: expect.stringContaining("another app"),
    });
  });

  it("rejects an unusable profile (no name / no tools) with an explanation", () => {
    expect(parseCustomProfileFile(JSON.stringify(validProfile({ name: "" })))).toMatchObject({
      ok: false,
      error: expect.stringContaining("usable"),
    });
    expect(parseCustomProfileFile(JSON.stringify(validProfile({ tools: [] })))).toMatchObject({
      ok: false,
      error: expect.stringContaining("usable"),
    });
  });

  it("rejects present-but-malformed fields instead of silently defaulting", () => {
    expect(parseCustomProfileFile(JSON.stringify({ ...validProfile(), tools: "shell" }))).toMatchObject({
      ok: false,
      error: expect.stringContaining("tool list"),
    });
    expect(parseCustomProfileFile(JSON.stringify({ ...validProfile(), safety: "nope" }))).toMatchObject({
      ok: false,
      error: expect.stringContaining("safety"),
    });
  });

  it("tolerates unknown extra fields (forward-compatible)", () => {
    const parsed = parseCustomProfileFile(JSON.stringify({ ...validProfile(), extraField: 42, nested: { a: 1 } }));
    expect(parsed.ok).toBe(true);
  });
});

describe("mergeImportedProfile — never silently overwrite", () => {
  it("adopts a profile as-is when nothing collides (round-trip identity)", () => {
    const imported = validProfile();
    const { profile, resolution } = mergeImportedProfile(imported, []);
    expect(profile).toEqual(imported);
    expect(resolution).toBeNull();
  });

  it("fresh id on an id collision, name untouched", () => {
    const imported = validProfile();
    const existing = [validProfile({ name: "Different Name" })]; // same id, different name
    const { profile, resolution } = mergeImportedProfile(imported, existing);
    expect(profile.id).not.toBe(imported.id);
    expect(profile.name).toBe(imported.name);
    expect(resolution).toMatchObject({ idChanged: true, renamed: false });
  });

  it("renames to a unique copy name on a name collision, id untouched", () => {
    const imported = validProfile();
    const existing = [validProfile({ id: "custom-other" })]; // same name, different id
    const { profile, resolution } = mergeImportedProfile(imported, existing);
    expect(profile.name).toBe("Builder Bot (copy)");
    expect(profile.id).toBe(imported.id);
    expect(resolution).toMatchObject({ renamed: true, idChanged: false, originalName: "Builder Bot", finalName: "Builder Bot (copy)" });
  });

  it("handles id AND name colliding at once", () => {
    const imported = validProfile();
    const { profile, resolution } = mergeImportedProfile(imported, [validProfile()]);
    expect(profile.id).not.toBe(imported.id);
    expect(profile.name).toBe("Builder Bot (copy)");
    expect(resolution).toMatchObject({ idChanged: true, renamed: true });
  });

  it("escalates to (copy 2), (copy 3)… when copies already exist", () => {
    const existing = [
      validProfile({ id: "custom-1" }),
      validProfile({ id: "custom-2", name: "Builder Bot (copy)" }),
      validProfile({ id: "custom-3", name: "Builder Bot (copy 2)" }),
    ];
    const { profile } = mergeImportedProfile(validProfile({ id: "custom-4" }), existing);
    expect(profile.name).toBe("Builder Bot (copy 3)");
  });

  it("treats name collisions case/whitespace-insensitively", () => {
    const existing = [validProfile({ id: "custom-1", name: "  builder bot " })];
    const { profile, resolution } = mergeImportedProfile(validProfile({ id: "custom-9" }), existing);
    expect(profile.name).toBe("Builder Bot (copy)");
    expect(resolution?.renamed).toBe(true);
  });

  it("never mutates the existing list or its entries", () => {
    const imported = validProfile();
    const existing = [validProfile()];
    const snapshot = JSON.stringify(existing);
    mergeImportedProfile(imported, existing);
    expect(JSON.stringify(existing)).toBe(snapshot);
  });
});

describe("round-trip — export then import reproduces the same profile", () => {
  it("reproduces an identical composition through serialize → parse → merge", () => {
    const original = validProfile({
      id: "custom-roundtrip",
      name: "Round Tripper",
      tagline: "Exact every time",
      workingStyle: ["One chip", "Two chips"],
      mode: "code",
      tools: [...CODE_MODE_TOOLS],
      skills: ["All enabled skills"],
      safety: { autoApprove: false, confirm: ["Destructive shell", "Program run"] },
    });
    const file = serializeCustomProfile(original);
    const parsed = parseCustomProfileFile(file);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const { profile: merged, resolution } = mergeImportedProfile(parsed.profile, []);
    expect(resolution).toBeNull(); // fresh store → adopted as-is
    expect(merged).toEqual(original);
    // The composition — the bar's round-trip check — is byte-identical.
    expect(merged.tools).toEqual(original.tools);
    expect(merged.skills).toEqual(original.skills);
    expect(merged.safety).toEqual(original.safety);
    expect(merged.mode).toBe(original.mode);
  });

  it("is stable — serializing the parsed profile yields the same profile content", () => {
    const original = validProfile();
    const first = serializeCustomProfile(original);
    const parsed = parseCustomProfileFile(first);
    if (!parsed.ok) throw new Error("expected a valid parse");
    const second = serializeCustomProfile(parsed.profile);
    expect(JSON.parse(second)).toEqual(JSON.parse(first));
  });
});

describe("describeImportOutcome — the visible resolution notice", () => {
  it("phrases a clean import as success", () => {
    const outcome: CustomProfileImportResult = { profile: validProfile(), resolution: null };
    const { kind, message } = describeImportOutcome(outcome);
    expect(kind).toBe("success");
    expect(message).toContain("Builder Bot");
  });

  it("phrases a collision resolution explicitly — never silent", () => {
    const outcome: CustomProfileImportResult = {
      profile: validProfile({ name: "Builder Bot (copy)" }),
      resolution: { idChanged: false, renamed: true, originalName: "Builder Bot", finalName: "Builder Bot (copy)" },
    };
    const { kind, message } = describeImportOutcome(outcome);
    expect(kind).toBe("collision");
    expect(message).toContain("Builder Bot (copy)");
    expect(message).toContain("already exists");
    expect(message).toContain("nothing was overwritten");
  });
});

describe("file I/O — browser-preview paths (no Tauri in jsdom)", () => {
  it("exports via a Blob download and reports the file name", async () => {
    const result = await exportProfileToFile(validProfile());
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.detail).toContain("Downloaded");
  });

  it("imports a picked file through the browser file input (FileReader)", async () => {
    const clicked: HTMLInputElement[] = [];
    const originalClick = HTMLInputElement.prototype.click;
    HTMLInputElement.prototype.click = function clickCapture() {
      clicked.push(this);
    };
    try {
      const promise = importProfileFromFile();
      // The hidden input was created + "clicked" — simulate a real user pick.
      const input = clicked[0];
      expect(input).toBeTruthy();
      const file = new File([serializeCustomProfile(validProfile())], "builder.sophos-profile.json", { type: "application/json" });
      Object.defineProperty(input, "files", { value: [file], configurable: true });
      input.dispatchEvent(new Event("change", { bubbles: true }));
      const result = await promise;
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.text).toContain("Builder Bot");
        expect(result.detail).toContain("builder.sophos-profile.json");
      }
    } finally {
      HTMLInputElement.prototype.click = originalClick;
    }
  });

  it("treats a cancelled browser picker (focus returns, no change) as cancelled", async () => {
    const originalClick = HTMLInputElement.prototype.click;
    HTMLInputElement.prototype.click = function noop() {};
    try {
      const promise = importProfileFromFile();
      window.dispatchEvent(new Event("focus"));
      const result = await promise;
      expect(result).toMatchObject({ ok: false, cancelled: true });
    } finally {
      HTMLInputElement.prototype.click = originalClick;
    }
  });
});
