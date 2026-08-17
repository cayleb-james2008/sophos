// Agent profiles (v0.7) — presets that compose which model, tools, skills, and
// safety an agent uses, in the spirit of the DeepSeek Harness runtime modes
// (Standard / Minimal / Creator) and the Gauntlet skill set's working style.
//
// The built-in **Gauntlet** baseline embeds the working style the gauntlet
// skills teach (goal + bar first, blind self-review against the bar,
// check-before-build probes, plain-English reporting, honest evidence
// markers). The three runtime modes compose the capability surface:
//
//   Standard — full toolset, balanced defaults (the Harness "Standard mode")
//   Minimal  — a lean, focused agent (the Harness "Minimal mode": shell + editor)
//   Creator  — everything on, exploratory, safe tools auto-approved
//   Code     — the agent's tools exposed as a typed TypeScript SDK; one program
//              calls many tools in a single step (DeepSeek Harness "Code mode")
//
// Selecting a profile is persisted in settings (`agentProfile`) and visibly
// changes how the agent works: the chat header shows the active profile, the
// composer reflects its working style, and (in demo mode) the simulated agent
// answers in the profile's style while keeping every existing anchor string.

import { createContext, createElement, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useIpc } from "../../ipc/client";
import type { Settings } from "../../ipc/contract";
import { CODE_MODE_TOOLS } from "../code/toolRegistry";
import {
  CUSTOM_PROFILES_SETTINGS_KEY,
  createCustomProfileDraft,
  isCustomProfileUsable,
  parseCustomProfiles,
  sanitizeCustomProfile,
  type CustomProfile,
} from "../studio/store";
import { studioReducer, type StudioAction } from "../studio/editor";
import { mergeImportedProfile, type ImportResolution } from "../studio/portable";

export type ProfileMode = "standard" | "minimal" | "creator" | "code";

export interface ProfileComposition {
  mode: ProfileMode;
  /** Preferred model for the profile, when it pins one. */
  model?: { provider: string; model: string; thinking?: string };
  /** Enabled tool names. */
  tools: string[];
  /** Enabled skills. */
  skills: string[];
  /** Safety posture. */
  safety: { autoApprove: boolean; confirm: string[] };
}

export interface AgentProfile {
  id: string;
  name: string;
  tagline: string;
  description: string;
  /** The working-style chips shown in the picker. */
  workingStyle: string[];
  /** Instructions the agent follows (shown in-app; applied to prompt options). */
  systemPrompt: string;
  mode: ProfileMode;
}

const MODE_TOOLS: Record<ProfileMode, string[]> = {
  standard: ["shell", "file editor", "file search", "web search", "kernel", "refine"],
  minimal: ["shell", "file editor"],
  creator: ["shell", "file editor", "file search", "web search", "kernel", "refine", "runtime inspect", "plugin experiments"],
  // Code mode exposes the agent's tools as a typed TypeScript SDK — the tool
  // names here mirror the built-in registry the SDK renderer emits stubs for.
  code: CODE_MODE_TOOLS,
};

const MODE_SKILLS: Record<ProfileMode, string[]> = {
  standard: ["All enabled skills"],
  minimal: [],
  creator: ["All enabled skills", "Experimental"],
  // Code mode keeps every discovered skill invocable from a program; skills
  // surface in the SDK registry as typed stubs alongside the built-ins.
  code: ["All enabled skills", "SDK stubs"],
};

const MODE_SAFETY: Record<ProfileMode, { autoApprove: boolean; confirm: string[] }> = {
  standard: { autoApprove: false, confirm: ["Destructive shell"] },
  minimal: { autoApprove: false, confirm: ["All tool use"] },
  creator: { autoApprove: true, confirm: [] },
  // Code mode runs whole programs, so each program run is confirmed up front
  // (the program may call many tools in a single step).
  code: { autoApprove: false, confirm: ["Program run"] },
};

export function compositionFor(profile: AgentProfile): ProfileComposition {
  // Custom profiles (Profile Studio) carry their explicit composition; the
  // built-ins derive it from the runtime mode. Built-in compositions stay
  // byte-identical to v0.7.
  const custom = profile as AgentProfile & Partial<CustomProfile>;
  if (Array.isArray(custom.tools) && Array.isArray(custom.skills) && custom.safety && typeof custom.safety.autoApprove === "boolean") {
    return {
      mode: profile.mode,
      tools: [...custom.tools],
      skills: [...custom.skills],
      safety: { autoApprove: custom.safety.autoApprove, confirm: [...custom.safety.confirm] },
    };
  }
  return {
    mode: profile.mode,
    model: profile.id === "gauntlet" ? undefined : undefined,
    tools: MODE_TOOLS[profile.mode],
    skills: MODE_SKILLS[profile.mode],
    safety: MODE_SAFETY[profile.mode],
  };
}

export const GAUNTLET_PROFILE: AgentProfile = {
  id: "gauntlet",
  name: "Gauntlet",
  tagline: "Goal + bar first, then blind self-review",
  description:
    "Works the way the Gauntlet skill set teaches: state the goal and the bar up front, probe that the tools exist before building, judge the finished work against the bar with fresh eyes, and report in plain English with honest evidence markers.",
  workingStyle: [
    "Goal + bar first",
    "Blind self-review against the bar",
    "Check before you build",
    "Plain-English reporting",
    "Honest evidence markers",
  ],
  systemPrompt:
    "You work in the Gauntlet style. Before any task: restate the goal and the bar — what 'done' means, concretely and checkably. Before building, run quick checks that the tools and conditions exist. When you finish, review your own output against the bar with fresh eyes before reporting. Report in plain English: Status — what ran and how fresh the evidence is; Verified — what passed, with the evidence path; Unverified — what wasn't proven, and why; Blockers — anything in the way; Next action — one concrete step. No unexplained jargon. Mark claims GREEN (freshly verified), UNVERIFIED (say why), or NOT APPLICABLE. Never invent evidence, numbers, or sources.",
  mode: "standard",
};

export const STANDARD_PROFILE: AgentProfile = {
  id: "standard",
  name: "Standard",
  tagline: "Full toolset, balanced defaults",
  description:
    "The DeepSeek Harness Standard mode: a full coding agent with file editing, shell, file and web search, skills, planning, goals, and subagents. Balanced safety — destructive actions still ask first.",
  workingStyle: ["Full toolset", "Balanced safety"],
  systemPrompt:
    "You are a capable coding agent with the full toolset. Work efficiently: use the shell and file tools to verify claims, use search before guessing, and keep answers clear and direct. Ask before destructive actions.",
  mode: "standard",
};

export const MINIMAL_PROFILE: AgentProfile = {
  id: "minimal",
  name: "Minimal",
  tagline: "Shell + editor, lean and focused",
  description:
    "The DeepSeek Harness Minimal mode: a two-tool agent (persistent shell + file editor) for focused, single-surface work. Fewer tools, fewer surprises, every action confirmed.",
  workingStyle: ["Two tools only", "Confirm everything"],
  systemPrompt:
    "You run in Minimal mode: only a shell and a file editor are available. Keep the work to one focused surface. Confirm before every tool action. Answers stay short and factual.",
  mode: "minimal",
};

export const CREATOR_PROFILE: AgentProfile = {
  id: "creator",
  name: "Creator",
  tagline: "Everything on, explore and compose",
  description:
    "The DeepSeek Harness Creator mode: all Standard capabilities plus runtime inspection and experimentation. Safe tools run without confirmation so exploratory builds flow; you can see the composition at any time.",
  workingStyle: ["Everything enabled", "Safe tools auto-approved", "Explore and compose"],
  systemPrompt:
    "You run in Creator mode: every capability is available, including runtime inspection and experiments. Explore broadly, combine tools creatively, and verify claims with real runs. Safe tool actions are auto-approved; destructive ones still ask.",
  mode: "creator",
};

export const CODE_PROFILE: AgentProfile = {
  id: "code",
  name: "Code",
  tagline: "One program, many tool calls — SDK-driven",
  description:
    "The DeepSeek Harness Code mode: the agent's tools are exposed as a typed TypeScript SDK, so the agent writes one program that calls many tools in a single step instead of dozens of separate tool round-trips. The SDK renders deterministically from the live tool registry (built-ins + extension/MCP tools + skills); each run_code program decomposes into its individual tool-call cards and Trajectory entries.",
  workingStyle: ["Typed TS SDK", "One program, many calls", "Deterministic renderer", "run_code decomposition"],
  systemPrompt:
    "You run in Code mode: every registered tool is exposed to you as a typed TypeScript SDK function. Write ONE program that calls many tools in a single step, then run it with run_code. Prefer composing tools in one program over many separate round-trips. Verify tool availability from the SDK before building, and keep the program deterministic. In demo mode, programs are simulated and decomposed into tool-call cards — never claim a live tool ran.",
  mode: "code",
};

export const PROFILES: AgentProfile[] = [GAUNTLET_PROFILE, STANDARD_PROFILE, MINIMAL_PROFILE, CREATOR_PROFILE, CODE_PROFILE];

export const MODES: Array<{ id: ProfileMode; label: string }> = [
  { id: "standard", label: "Standard" },
  { id: "minimal", label: "Minimal" },
  { id: "creator", label: "Creator" },
  { id: "code", label: "Code" },
];

export function profileById(id: string | undefined): AgentProfile {
  return PROFILES.find((p) => p.id === id) ?? STANDARD_PROFILE;
}

export interface ProfileSelection {
  id: string;
  mode: ProfileMode;
}

const DEFAULT_SELECTION: ProfileSelection = { id: "standard", mode: "standard" };

function asSelection(value: unknown): ProfileSelection {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const v = value as Record<string, unknown>;
    const id = typeof v.id === "string" ? v.id : undefined;
    const mode = v.mode === "minimal" || v.mode === "creator" || v.mode === "code" ? v.mode : v.mode === "standard" ? "standard" : undefined;
    if (id && mode) return { id, mode };
  }
  return DEFAULT_SELECTION;
}

/**
 * Active profile state. Persisted in settings so the selection survives
 * restarts; additive settings fields (`agentProfile` and the Profile Studio's
 * `customProfiles`) — the bridge and daemon ignore unknown settings keys, so
 * nothing upstream changes.
 */
export interface ProfileApi {
  selection: ProfileSelection;
  /** The EFFECTIVE profile — the studio draft while the studio is open (hot
   * reload), otherwise the resolved selection. Degrades to Standard defaults
   * when a custom profile is unusable (no name / no tools). */
  profile: AgentProfile;
  composition: ProfileComposition;
  loaded: boolean;
  setProfile: (id: string, mode?: ProfileMode) => Promise<void>;
  setMode: (mode: ProfileMode) => Promise<void>;

  // --- Profile Studio (v0.7.1) ---
  /** Custom profiles loaded from settings (additive `customProfiles` key). */
  customProfiles: CustomProfile[];
  studioOpen: boolean;
  /** The in-memory draft the running app follows while the studio is open. */
  studioDraft: CustomProfile | null;
  /** The custom profile being edited, when the studio opened in edit mode. */
  studioEditingId: string | null;
  openStudioCreate: () => void;
  openStudioEdit: (id: string) => void;
  closeStudio: () => void;
  /** Dispatch an editor action — hot-reloads the draft into the running app. */
  studioDispatch: (action: StudioAction) => void;
  /** Validate + persist the draft to settings; selects a newly created profile. */
  saveDraft: () => Promise<void>;
  /** Remove a custom profile; falls back to Standard when it was selected. */
  deleteCustomProfile: (id: string) => Promise<void>;
  /**
   * Import a parsed custom profile (portability half): collision-safe merge
   * against the live store (never overwrites — see mergeImportedProfile),
   * persists, selects it so its effect is visible immediately, and returns
   * the outcome so the UI can show the resolution. No file I/O here — callers
   * read/parse the file first. */
  importCustomProfile: (profile: CustomProfile) => Promise<CustomProfileImportResult>;
}

/** Outcome of importCustomProfile — the adopted profile + the resolution (if
 * the merge had to rename / re-id it). */
export interface CustomProfileImportResult {
  profile: CustomProfile;
  resolution: ImportResolution | null;
}

/** Human phrasing of an import outcome for a VISIBLE notice (never silent). */
export function describeImportOutcome(outcome: CustomProfileImportResult): { kind: "success" | "collision"; message: string } {
  const r = outcome.resolution;
  if (r) {
    return {
      kind: "collision",
      message: `Imported as “${r.finalName}” — “${r.originalName}” already exists, so nothing was overwritten.`,
    };
  }
  return { kind: "success", message: `Imported “${outcome.profile.name}”.` };
}

function useProfileState(): ProfileApi {
  const ipc = useIpc();
  const [selection, setSelection] = useState<ProfileSelection>(DEFAULT_SELECTION);
  const [loaded, setLoaded] = useState(false);
  const [customProfiles, setCustomProfiles] = useState<CustomProfile[]>([]);
  const [studio, setStudio] = useState<{ open: boolean; editingId: string | null; draft: CustomProfile | null }>({
    open: false,
    editingId: null,
    draft: null,
  });

  // Refs so stable callbacks (save/delete) always read the latest state.
  const customProfilesRef = useRef(customProfiles);
  customProfilesRef.current = customProfiles;
  const selectionRef = useRef(selection);
  selectionRef.current = selection;
  const studioRef = useRef(studio);
  studioRef.current = studio;

  useEffect(() => {
    let mounted = true;
    // Some test mocks / minimal clients expose only a partial surface — guard
    // so a missing getSettings degrades to the default instead of crashing.
    if (typeof ipc.getSettings !== "function") {
      setLoaded(true);
      return;
    }
    ipc
      .getSettings()
      .then((settings) => {
        if (!mounted) return;
        const s = settings as Settings & { agentProfile?: unknown; customProfiles?: unknown };
        setSelection(asSelection(s.agentProfile));
        // Guarded parse — a malformed persisted list sanitizes to [] / clean
        // entries instead of crashing the app.
        setCustomProfiles(parseCustomProfiles(s.customProfiles));
      })
      .catch(() => {
        // Offline — keep the default.
      })
      .finally(() => {
        if (mounted) setLoaded(true);
      });
    return () => {
      mounted = false;
    };
  }, [ipc]);

  const apply = useCallback(
    async (next: ProfileSelection) => {
      setSelection(next);
      if (typeof ipc.getSettings !== "function" || typeof ipc.setSettings !== "function") return;
      try {
        const settings = await ipc.getSettings().catch(() => ({}));
        await ipc.setSettings({ ...settings, agentProfile: next } as Settings).catch(() => undefined);
      } catch {
        // Persistence is best-effort; the in-memory selection still applies.
      }
    },
    [ipc],
  );

  /** Persist the custom-profile store (additive settings key, best-effort). */
  const persistCustoms = useCallback(
    async (next: CustomProfile[]) => {
      setCustomProfiles(next);
      if (typeof ipc.getSettings !== "function" || typeof ipc.setSettings !== "function") return;
      try {
        const settings = await ipc.getSettings().catch(() => ({}));
        await ipc.setSettings({ ...settings, [CUSTOM_PROFILES_SETTINGS_KEY]: next } as Settings).catch(() => undefined);
      } catch {
        // Persistence is best-effort; the in-memory store still applies.
      }
    },
    [ipc],
  );

  const setProfile = useCallback(
    (id: string, mode?: ProfileMode) => {
      const custom = customProfilesRef.current.find((p) => p.id === id);
      const profile = custom ?? profileById(id);
      return apply({ id, mode: mode ?? profile.mode });
    },
    [apply],
  );

  const setMode = useCallback(
    (mode: ProfileMode) => apply({ ...selection, mode }),
    [apply, selection],
  );

  // --- Profile Studio actions (v0.7.1) ---

  const openStudioCreate = useCallback(() => {
    // Seed from the current runtime mode so the studio starts where you are.
    setStudio({ open: true, editingId: null, draft: createCustomProfileDraft({ mode: selectionRef.current.mode }) });
  }, []);

  const openStudioEdit = useCallback((id: string) => {
    const found = customProfilesRef.current.find((p) => p.id === id);
    if (!found) return;
    setStudio({ open: true, editingId: id, draft: sanitizeCustomProfile(found) });
  }, []);

  const closeStudio = useCallback(() => {
    setStudio({ open: false, editingId: null, draft: null });
  }, []);

  const studioDispatch = useCallback((action: StudioAction) => {
    setStudio((s) => (s.draft ? { ...s, draft: studioReducer(s.draft, action) } : s));
  }, []);

  const saveDraft = useCallback(async () => {
    const s = studioRef.current;
    if (!s.open || !s.draft) return;
    const draft = sanitizeCustomProfile({ ...s.draft, updatedAt: new Date().toISOString() });
    // Unusable drafts (no name / no tools) can't be saved — the app keeps
    // degrading to Standard defaults instead of persisting something broken.
    if (!isCustomProfileUsable(draft)) return;
    const existing = customProfilesRef.current.some((p) => p.id === draft.id);
    const next = existing
      ? customProfilesRef.current.map((p) => (p.id === draft.id ? draft : p))
      : [...customProfilesRef.current, draft];
    await persistCustoms(next);
    setStudio({ open: false, editingId: null, draft: null });
    // A newly created profile becomes the active selection so its effect is
    // visible immediately; editing keeps the current selection.
    if (!existing) await apply({ id: draft.id, mode: draft.mode });
  }, [persistCustoms, apply]);

  const deleteCustomProfile = useCallback(
    async (id: string) => {
      const next = customProfilesRef.current.filter((p) => p.id !== id);
      await persistCustoms(next);
      if (selectionRef.current.id === id) {
        // The deleted profile was active — fall back to Standard defaults.
        await apply({ id: "standard", mode: "standard" });
      }
      if (studioRef.current.editingId === id) {
        setStudio({ open: false, editingId: null, draft: null });
      }
    },
    [persistCustoms, apply],
  );

  /** Portability half: import a parsed profile — merge (never overwrite),
   * persist, and select it so its effect is visible immediately. */
  const importCustomProfile = useCallback(
    async (profile: CustomProfile): Promise<CustomProfileImportResult> => {
      const { profile: merged, resolution } = mergeImportedProfile(profile, customProfilesRef.current);
      const next = [...customProfilesRef.current, merged];
      await persistCustoms(next);
      await apply({ id: merged.id, mode: merged.mode });
      return { profile: merged, resolution };
    },
    [persistCustoms, apply],
  );

  // --- Effective profile (hot reload) ---
  // While the studio is open the running app follows the DRAFT (valid ones as
  //-is; unusable ones degrade to Standard). Otherwise it follows the resolved
  // selection — custom ids resolve through the store, and a missing/unusable
  // custom degrades to Standard instead of crashing.
  const effectiveProfile: AgentProfile = studio.draft
    ? isCustomProfileUsable(studio.draft)
      ? studio.draft
      : STANDARD_PROFILE
    : selection.id.startsWith("custom-")
      ? (customProfiles.find((p) => p.id === selection.id && isCustomProfileUsable(p)) ?? STANDARD_PROFILE)
      : profileById(selection.id);
  const effectiveMode: ProfileMode = studio.draft ? studio.draft.mode : selection.mode;
  const composition = compositionFor({ ...effectiveProfile, mode: effectiveMode });

  return {
    selection,
    profile: effectiveProfile,
    composition,
    loaded,
    setProfile,
    setMode,
    customProfiles,
    studioOpen: studio.open,
    studioDraft: studio.draft,
    studioEditingId: studio.editingId,
    openStudioCreate,
    openStudioEdit,
    closeStudio,
    studioDispatch,
    saveDraft,
    deleteCustomProfile,
    importCustomProfile,
  };
}

/**
 * Shared active-profile state. <ProfileProvider> mounts once in App so the
 * header chip, the composer hint, and the prompt options all follow the same
 * selection. Standalone consumers (unit tests, isolated mounts) fall back to
 * their own instance so nothing depends on the provider being present.
 */
const ProfileContext = createContext<ProfileApi | null>(null);

export function ProfileProvider({ children }: { children: ReactNode }) {
  const api = useProfileState();
  return createElement(ProfileContext.Provider, { value: api }, children);
}

export function useProfile(): ProfileApi {
  const ctx = useContext(ProfileContext);
  return ctx ?? useProfileState();
}

/** Compact human summary of a profile's composition (shown in the picker). */
export function compositionSummary(composition: ProfileComposition): string {
  const tools = composition.tools.length ? composition.tools.join(", ") : "no tools";
  const skills = composition.skills.length ? composition.skills.join(", ") : "no skills";
  const safety = composition.safety.autoApprove ? "safe tools auto-approved" : `confirms: ${composition.safety.confirm.join(", ") || "nothing"}`;
  const sdk = composition.mode === "code" ? ` · SDK: ${composition.tools.length} tools rendered as typed TypeScript stubs` : "";
  return `Tools: ${tools} · Skills: ${skills} · Safety: ${safety}${sdk}`;
}
