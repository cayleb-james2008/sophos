// store — the custom-profile store (v0.7.1 Profile Studio).
//
// The studio is the DeepSeek Harness Creator mode made visual: inspect the
// live runtime (through the Code Mode registry's sources), compose a custom
// agent profile, and test it in memory (hot reload — the running app follows
// the draft before anything is saved).
//
// Custom profiles persist in settings under the ADDITIVE `customProfiles` key —
// exactly like `agentProfile`, `mcpServers`, and `disabledSkills`: the bridge
// SettingsStore merges unknown keys and the daemon ignores them, so nothing
// upstream changes. Parsing is guarded: malformed settings never crash the
// app — they sanitize to defaults or drop the bad entry entirely. An unusable
// profile (no name, no tools) DEGRADES to Standard defaults instead of
// throwing, so the header chip, composer hint, and demo responses always have
// something sane to render.
//
// The daemon seam is documented in CHANGELOG/README: like the built-in
// profiles, a custom profile's instructions are an additive UI-layer hint —
// the frontend flavors demo responses and shows the working style, while the
// bridge strips unknown prompt-option fields before they reach the daemon.

import type { AgentProfile, ProfileComposition, ProfileMode } from "../profiles/profiles";
import { CODE_MODE_TOOLS } from "../code/toolRegistry";

/** A user-built profile. Extends AgentProfile with the explicit capability
 * composition the studio edits (base mode + toggled tools/skills/safety). */
export interface CustomProfile extends AgentProfile {
  /** Explicit tool set, toggled from the live registry. */
  tools: string[];
  /** Explicit skill set, toggled from the live runtime's discovered skills. */
  skills: string[];
  /** Safety posture: auto-approve safe tools, or confirm a named list. */
  safety: { autoApprove: boolean; confirm: string[] };
  createdAt?: string;
  updatedAt?: string;
}

/** Settings key the store persists under (additive; bridge merges unknown keys). */
export const CUSTOM_PROFILES_SETTINGS_KEY = "customProfiles";

const BUILTIN_IDS = new Set(["gauntlet", "standard", "minimal", "creator", "code"]);

// A fresh draft composes the BUILT-IN REGISTRY's tool names (shell, read_file,
// edit_file, …) so every default tool maps 1:1 to a live-registry toggle in the
// studio — display-name defaults would silently not match any toggle.
const DEFAULT_CUSTOM_TOOLS = [...CODE_MODE_TOOLS];

// ---------------------------------------------------------------------------
// Guarded parsing / sanitizing
// ---------------------------------------------------------------------------

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    if (typeof item === "string" && item.trim()) {
      const t = item.trim();
      if (!out.includes(t)) out.push(t);
    }
  }
  return out;
}

function asMode(value: unknown): ProfileMode {
  return value === "minimal" || value === "creator" || value === "code" ? value : value === "standard" ? "standard" : "standard";
}

function asSafety(value: unknown): { autoApprove: boolean; confirm: string[] } {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const v = value as Record<string, unknown>;
    return { autoApprove: v.autoApprove === true, confirm: asStringArray(v.confirm) };
  }
  return { autoApprove: false, confirm: [] };
}

/**
 * Coerce an unknown value into a well-formed CustomProfile. Never throws:
 * missing/malformed fields fall back to safe defaults (Standard-style tools,
 * no skills, confirm-list safety). Used by parseCustomProfiles and by the
 * editor when a draft is re-derived from persisted state.
 */
export function sanitizeCustomProfile(raw: unknown): CustomProfile {
  const r = (raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>;
  const id = asString(r.id) || newCustomProfileId();
  const name = asString(r.name).trim();
  const mode = asMode(r.mode);
  // Preserve an EXPLICIT empty tool list so isCustomProfileUsable can flag the
  // profile unusable (→ degrades to Standard at activation). Only garbage
  // (non-array) input falls back to the Standard-style default set.
  const tools = Array.isArray(r.tools) ? asStringArray(r.tools) : r.tools === undefined ? [] : [...DEFAULT_CUSTOM_TOOLS];
  const skills = asStringArray(r.skills);
  const safety = asSafety(r.safety);
  const workingStyle = asStringArray(r.workingStyle);
  const tagline = asString(r.tagline).trim();
  const description = asString(r.description).trim();

  const base: CustomProfile = {
    id,
    // The RAW name is preserved (even when empty) so isCustomProfileUsable can
    // flag the profile unusable — the app then degrades to Standard defaults
    // instead of rendering a blank chip. The "Untitled profile" label is a
    // render-time fallback only.
    name,
    tagline,
    description,
    workingStyle: workingStyle.length ? workingStyle : ["Custom composition"],
    systemPrompt: asString(r.systemPrompt),
    mode,
    tools,
    skills,
    safety: { autoApprove: safety.autoApprove, confirm: [...safety.confirm] },
    createdAt: asString(r.createdAt) || undefined,
    updatedAt: asString(r.updatedAt) || undefined,
  };
  // Always synthesize a coherent system prompt from the editable fields so the
  // stored instructions can never drift from what the studio shows.
  base.systemPrompt = buildCustomSystemPrompt(base);
  return base;
}

/** Parse the persisted settings value into a clean custom-profile array.
 * Garbage in → [] out; individual bad entries are sanitized, never thrown. */
export function parseCustomProfiles(value: unknown): CustomProfile[] {
  if (!Array.isArray(value)) return [];
  const out: CustomProfile[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    // Non-object junk (null / numbers / strings) is dropped — only real
    // entries are sanitized.
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const p = sanitizeCustomProfile(entry);
    if (seen.has(p.id)) continue; // duplicate ids — keep the first
    seen.add(p.id);
    out.push(p);
  }
  return out;
}

/** A profile is usable when it has a name and at least one tool. Anything
 * else degrades to Standard defaults instead of crashing the app. */
export function isCustomProfileUsable(profile: CustomProfile): boolean {
  return profile.name.trim().length > 0 && profile.tools.length > 0;
}

export function isCustomId(id: string): boolean {
  return !BUILTIN_IDS.has(id) && id.startsWith("custom-");
}

// ---------------------------------------------------------------------------
// Creation / synthesis
// ---------------------------------------------------------------------------

let idCounter = 0;

/** Fresh, collision-safe id for a new custom profile. */
export function newCustomProfileId(): string {
  idCounter += 1;
  return `custom-${Date.now().toString(36)}-${idCounter.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/** A brand-new draft for the studio (create mode). Base mode + tool set start
 * from Standard so a fresh profile is immediately usable. */
export function createCustomProfileDraft(patch: Partial<CustomProfile> = {}): CustomProfile {
  const now = new Date().toISOString();
  return sanitizeCustomProfile({
    id: newCustomProfileId(),
    name: "",
    tagline: "",
    description: "",
    workingStyle: [],
    mode: "standard",
    tools: [...DEFAULT_CUSTOM_TOOLS],
    skills: [],
    safety: { autoApprove: false, confirm: [] },
    createdAt: now,
    ...patch,
  });
}

/**
 * Synthesize the system prompt from the editable fields — the same recipe the
 * built-in profiles use (name + mode + working style), so a custom profile's
 * instructions always match what the studio shows.
 */
export function buildCustomSystemPrompt(profile: Pick<CustomProfile, "name" | "mode" | "workingStyle" | "tagline">): string {
  const style = profile.workingStyle.length ? profile.workingStyle.join("; ") : "clear, direct work";
  const modeNote =
    profile.mode === "minimal"
      ? " Minimal mode: only the composed tools are available; confirm before destructive actions."
      : profile.mode === "creator"
        ? " Creator mode: everything composed is available and safe tool actions are auto-approved; destructive ones still ask."
        : profile.mode === "code"
          ? " Code mode: the composed tools are exposed through the typed TypeScript SDK — write ONE program that calls many tools in a single step."
          : " Standard mode: work efficiently with the composed toolset; ask before destructive actions.";
  return `You are running the custom profile “${profile.name}”. ${profile.tagline ? `Purpose: ${profile.tagline}. ` : ""}Working style: ${style}.${modeNote} Never invent evidence, numbers, or sources — verify claims with real runs and report honestly.`;
}

/** The composition a custom profile composes (explicit tools/skills/safety). */
export function customComposition(profile: CustomProfile): ProfileComposition {
  return {
    mode: profile.mode,
    tools: [...profile.tools],
    skills: [...profile.skills],
    safety: { autoApprove: profile.safety.autoApprove, confirm: [...profile.safety.confirm] },
  };
}

// ---------------------------------------------------------------------------
// Demo-mode flavor — the simulated agent answers in the profile's style
// ---------------------------------------------------------------------------

/**
 * The demo status block appended to simulated answers when a CUSTOM profile is
 * active. Mirrors the Gauntlet block's honesty (clearly a demo run) but
 * reflects the live draft: editing the name/tagline/working-style chips in the
 * studio changes the next simulated response immediately — before Save.
 */
export function customDemoFlavor(profile: Pick<CustomProfile, "name" | "tagline" | "workingStyle"> | undefined): string {
  if (!profile || !profile.name) return "";
  const style = profile.workingStyle.length ? profile.workingStyle.slice(0, 3).join(", ") : "custom composition";
  return [
    `\n\nStatus — demo run in the “${profile.name}” custom profile (simulated response; evidence is a UI round-trip, not a live tool run)`,
    profile.tagline ? `\nProfile — ${profile.tagline}` : "",
    `\nWorking style — ${style}`,
    "\nVerified — this reply followed the profile draft that is active right now (in-memory edits apply immediately; Save persists them)",
  ].join("");
}
