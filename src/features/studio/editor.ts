// editor — the studio's pure editor reducer (v0.7.1 Profile Studio).
//
// Every keystroke and toggle in the studio funnels through studioReducer,
// producing a NEW draft. The running app reads that draft directly (hot
// reload): the header chip, composer hint, composition summary, and (in demo
// mode) the simulated responses follow the draft immediately — Save persists,
// Discard drops it. Being pure, the reducer is trivially unit-testable and
// never touches IPC or React.

import type { ProfileMode } from "../profiles/profiles";
import { createCustomProfileDraft, isCustomProfileUsable, type CustomProfile } from "./store";

export type StudioAction =
  | { type: "name"; value: string }
  | { type: "tagline"; value: string }
  | { type: "description"; value: string }
  | { type: "workingStyleText"; value: string }
  | { type: "mode"; value: ProfileMode }
  | { type: "toggleTool"; name: string }
  | { type: "toggleSkill"; name: string }
  | { type: "setAutoApprove"; value: boolean }
  | { type: "confirmAdd"; value: string }
  | { type: "confirmRemove"; value: string }
  | { type: "reset"; profile: CustomProfile };

/** Split raw working-style input (lines or commas) into clean chips. */
export function workingStyleFromText(text: string): string[] {
  const out: string[] = [];
  for (const part of text.split(/[\n,]+/)) {
    const t = part.trim();
    if (t && !out.includes(t)) out.push(t);
  }
  return out;
}

/** Render chips back to the editor's textarea (one chip per line). */
export function workingStyleToText(chips: string[]): string {
  return chips.join("\n");
}

function toggle(list: string[], name: string): string[] {
  return list.includes(name) ? list.filter((t) => t !== name) : [...list, name];
}

/** The pure editor reducer — returns a new draft for every action. */
export function studioReducer(draft: CustomProfile, action: StudioAction): CustomProfile {
  switch (action.type) {
    case "name":
      return { ...draft, name: action.value };
    case "tagline":
      return { ...draft, tagline: action.value };
    case "description":
      return { ...draft, description: action.value };
    case "workingStyleText":
      return { ...draft, workingStyle: workingStyleFromText(action.value) };
    case "mode":
      return { ...draft, mode: action.value };
    case "toggleTool":
      return { ...draft, tools: toggle(draft.tools, action.name) };
    case "toggleSkill":
      return { ...draft, skills: toggle(draft.skills, action.name) };
    case "setAutoApprove":
      return { ...draft, safety: { ...draft.safety, autoApprove: action.value } };
    case "confirmAdd": {
      const t = action.value.trim();
      if (!t || draft.safety.confirm.includes(t)) return draft;
      return { ...draft, safety: { ...draft.safety, confirm: [...draft.safety.confirm, t] } };
    }
    case "confirmRemove":
      return { ...draft, safety: { ...draft.safety, confirm: draft.safety.confirm.filter((c) => c !== action.value) } };
    case "reset":
      // A full replace — used by Discard and by openStudio(edit).
      return { ...action.profile, tools: [...action.profile.tools], skills: [...action.profile.skills], safety: { ...action.profile.safety, confirm: [...action.profile.safety.confirm] } };
    default:
      return draft;
  }
}

/** Reset a draft to a fresh (create-mode) template. */
export function freshDraft(mode: ProfileMode = "standard"): CustomProfile {
  return createCustomProfileDraft({ mode });
}

export { isCustomProfileUsable };

/** The live composition summary — updates with every toggle, shown in the
 * studio header and the picker's custom cards. Same phrasing as the built-in
 * compositionSummary so the whole picker reads consistently. */
export function studioCompositionSummary(profile: CustomProfile): string {
  const tools = profile.tools.length ? profile.tools.join(", ") : "no tools";
  const skills = profile.skills.length ? profile.skills.join(", ") : "no skills";
  const safety = profile.safety.autoApprove ? "safe tools auto-approved" : `confirms: ${profile.safety.confirm.join(", ") || "nothing"}`;
  return `Tools: ${tools} · Skills: ${skills} · Safety: ${safety}`;
}
