// portable — the Profile Studio's portability half (v0.7.1): export any
// custom profile to a human-readable JSON file and import it back or share it.
//
// Both halves of the studio — the in-memory editor and the file portability —
// consume the SAME custom-profile store (store.ts): export serializes a
// profile exactly as the store holds it, import parses a file back through the
// store's guarded sanitizer, and merge resolves collisions against the live
// store. Nothing here invents a second profile shape.
//
// File I/O uses the app's already-installed native file dialogs (the Tauri
// dialog plugin, permissioned in src-tauri/capabilities) plus two tiny shell
// commands (read_text_file / write_text_file) that read/write the chosen path
// — no new crates, no daemon-contract change. In the browser preview (vite
// dev, no Tauri) export falls back to a Blob download and import to a file
// input. Where neither exists (jsdom unit tests), the calls degrade honestly
// with a clear error instead of throwing.
//
// Parsing is guarded end to end: a malformed or unreadable file produces a
// clear error and never crashes, and a name collision is NEVER silently
// overwritten — merge renames the incoming profile to a unique "(copy)" name
// (and a fresh id when ids collide) and reports the resolution so the UI can
// show it visibly.

import { isTauri } from "../../ipc/client";
import {
  isCustomProfileUsable,
  newCustomProfileId,
  sanitizeCustomProfile,
  type CustomProfile,
} from "./store";

/** Marker in the exported envelope — lets any Sophos build identify the file. */
export const PROFILE_FILE_FORMAT = "sophos-custom-profile";
/** Version of the exported file shape. Bump on breaking format changes. */
export const PROFILE_FILE_VERSION = 1;

// ---------------------------------------------------------------------------
// Serialize / parse — the human-readable file format
// ---------------------------------------------------------------------------

/** The canonical file name for a profile's export ("my-builder.sophos-profile.json"). */
export function suggestProfileFileName(profile: Pick<CustomProfile, "name">): string {
  const base =
    profile.name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "custom-profile";
  return `${base}.sophos-profile.json`;
}

/**
 * Serialize a custom profile to the human-readable export format: a small
 * envelope (format + version + exportedAt) wrapping the store's canonical
 * profile shape, pretty-printed. The profile is sanitized first so the file
 * can never carry a malformed entry.
 */
export function serializeCustomProfile(profile: CustomProfile): string {
  const envelope = {
    format: PROFILE_FILE_FORMAT,
    version: PROFILE_FILE_VERSION,
    exportedAt: new Date().toISOString(),
    profile: sanitizeCustomProfile(profile),
  };
  return JSON.stringify(envelope, null, 2);
}

export type ParseProfileResult =
  | { ok: true; profile: CustomProfile }
  | { ok: false; error: string };

/**
 * Parse an exported file back into a profile. Accepts the envelope written by
 * serializeCustomProfile or a bare profile object (e.g. hand-edited). Guarded:
 * any malformed input yields a clear error, never a throw. A parsed profile
 * must be USABLE (a name and at least one tool) — otherwise the file is
 * rejected with an explanation rather than silently degrading.
 */
export function parseCustomProfileFile(text: string): ParseProfileResult {
  if (typeof text !== "string" || text.trim() === "") {
    return { ok: false, error: "The file is empty — nothing to import." };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, error: "The file is not valid JSON." };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ok: false, error: "The file does not contain a Sophos custom profile." };
  }
  const record = parsed as Record<string, unknown>;

  // Envelope or bare profile?
  let raw: unknown;
  if (record.format === PROFILE_FILE_FORMAT) {
    if (record.version !== undefined && record.version !== PROFILE_FILE_VERSION) {
      return {
        ok: false,
        error: `This profile file uses version ${JSON.stringify(record.version)}; this app reads version ${PROFILE_FILE_VERSION}.`,
      };
    }
    raw = record.profile;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      return { ok: false, error: "The file is a Sophos profile envelope but contains no profile object." };
    }
  } else if ("profile" in record) {
    // A foreign envelope — reject with a clear message instead of guessing.
    return { ok: false, error: "The file looks like an export from another app — it is not a Sophos custom profile." };
  } else {
    raw = record;
  }

  // Strict field checks BEFORE the store sanitizer: a present-but-wrong-typed
  // tools/skills/safety field means the file is broken, not "missing" — the
  // store sanitizer fills safe defaults for MISSING fields, but import should
  // not silently turn garbage into a working profile.
  const r = raw as Record<string, unknown>;
  if (r.tools !== undefined && !Array.isArray(r.tools)) {
    return { ok: false, error: "The profile's tool list is malformed (expected an array of tool names)." };
  }
  if (r.skills !== undefined && !Array.isArray(r.skills)) {
    return { ok: false, error: "The profile's skill list is malformed (expected an array of skill names)." };
  }
  if (r.safety !== undefined && (typeof r.safety !== "object" || r.safety === null || Array.isArray(r.safety))) {
    return { ok: false, error: "The profile's safety posture is malformed (expected an object)." };
  }

  const profile = sanitizeCustomProfile(raw);
  if (!isCustomProfileUsable(profile)) {
    return {
      ok: false,
      error: "The file does not contain a usable profile — a custom profile needs a name and at least one tool.",
    };
  }
  return { ok: true, profile };
}

// ---------------------------------------------------------------------------
// Merge — collision-safe import into the live store
// ---------------------------------------------------------------------------

/** What the merge changed, for a VISIBLE resolution notice (never silent). */
export interface ImportResolution {
  /** The incoming id collided, so a fresh id was assigned. */
  idChanged: boolean;
  /** The incoming name collided, so it was renamed to a unique copy name. */
  renamed: boolean;
  originalName: string;
  finalName: string;
}

/** Case-insensitive trimmed name equality — "Builder" and " builder " collide. */
function sameName(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/** Next unique copy name: "X (copy)", "X (copy 2)", "X (copy 3)", … */
function uniqueCopyName(name: string, existingNames: string[]): string {
  const trimmed = name.trim();
  const base = `${trimmed} (copy)`;
  if (!existingNames.some((n) => sameName(n, base))) return base;
  let i = 2;
  while (existingNames.some((n) => sameName(n, `${trimmed} (copy ${i})`))) i += 1;
  return `${trimmed} (copy ${i})`;
}

/**
 * Merge an imported profile into the existing store. NEVER overwrites: an id
 * collision gets a fresh id, a name collision gets a unique "(copy)" name
 * (both, when both collide). No collision → the profile is adopted as-is, so
 * an export → import round-trip reproduces the identical composition. Returns
 * the resolution so the UI can surface it visibly.
 */
export function mergeImportedProfile(
  imported: CustomProfile,
  existing: CustomProfile[],
): { profile: CustomProfile; resolution: ImportResolution | null } {
  const clean = sanitizeCustomProfile(imported);
  const idTaken = existing.some((p) => p.id === clean.id);
  const nameTaken = existing.some((p) => sameName(p.name, clean.name));

  if (!idTaken && !nameTaken) return { profile: clean, resolution: null };

  let profile: CustomProfile = { ...clean, tools: [...clean.tools], skills: [...clean.skills], safety: { ...clean.safety, confirm: [...clean.safety.confirm] } };
  const resolution: ImportResolution = { idChanged: false, renamed: false, originalName: clean.name, finalName: clean.name };

  if (idTaken) {
    profile = { ...profile, id: newCustomProfileId() };
    resolution.idChanged = true;
  }
  if (nameTaken) {
    const finalName = uniqueCopyName(clean.name, existing.map((p) => p.name));
    profile = { ...profile, name: finalName };
    resolution.renamed = true;
    resolution.finalName = finalName;
  }
  return { profile, resolution };
}

// ---------------------------------------------------------------------------
// File I/O — native dialogs (Tauri) with honest browser-preview fallbacks
// ---------------------------------------------------------------------------

export type ProfileFileResult =
  | { ok: true; detail: string }
  | { ok: false; cancelled: true }
  | { ok: false; cancelled: false; error: string };

/** Read a file the user picked in the native dialog (Tauri shell command). */
async function readViaTauri(path: string): Promise<{ ok: true; text: string } | { ok: false; cancelled: false; error: string }> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const text = await invoke<string>("read_text_file", { path });
    return { ok: true, text };
  } catch (err) {
    return { ok: false, cancelled: false, error: `Could not read the selected file: ${err instanceof Error ? err.message : String(err)}` };
  }
}

/** Write the exported file to a path the user chose in the native dialog. */
async function writeViaTauri(path: string, contents: string): Promise<{ ok: true } | { ok: false; cancelled: false; error: string }> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("write_text_file", { path, contents });
    return { ok: true };
  } catch (err) {
    return { ok: false, cancelled: false, error: `Could not write the file: ${err instanceof Error ? err.message : String(err)}` };
  }
}

/** Browser-preview import: a hidden file input + FileReader (no Tauri). */
async function pickInBrowser(): Promise<ProfileFileResult & { text?: string }> {
  if (typeof document === "undefined" || typeof FileReader === "undefined") {
    return { ok: false, cancelled: false, error: "File import is unavailable in this environment." };
  }
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".json,application/json";
  return new Promise<ProfileFileResult & { text?: string }>((resolve) => {
    let settled = false;
    const finish = (r: ProfileFileResult & { text?: string }) => {
      if (settled) return;
      settled = true;
      resolve(r);
    };
    input.addEventListener("change", () => {
      const file = input.files && input.files[0];
      if (!file) {
        finish({ ok: false, cancelled: true });
        return;
      }
      const reader = new FileReader();
      reader.onload = () => finish({ ok: true, detail: file.name, text: String(reader.result ?? "") });
      reader.onerror = () => finish({ ok: false, cancelled: false, error: "The selected file could not be read." });
      reader.readAsText(file);
    });
    // Browsers fire no event when the picker is cancelled — detect the focus
    // returning without a change as a cancel.
    const onFocus = () => window.setTimeout(() => finish({ ok: false, cancelled: true }), 300);
    window.addEventListener("focus", onFocus, { once: true });
    input.click();
  });
}

/** Browser-preview export: download the JSON via a temporary anchor. */
function downloadInBrowser(text: string, filename: string): ProfileFileResult {
  if (
    typeof document === "undefined" ||
    typeof Blob === "undefined" ||
    typeof URL === "undefined" ||
    typeof URL.createObjectURL !== "function"
  ) {
    return { ok: false, cancelled: false, error: "File export is unavailable in this environment." };
  }
  try {
    const blob = new Blob([text], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    return { ok: true, detail: `Downloaded ${filename}` };
  } catch (err) {
    return { ok: false, cancelled: false, error: `Could not save the file: ${err instanceof Error ? err.message : String(err)}` };
  }
}

/**
 * Export a profile through the NATIVE save dialog (Tauri) or a browser
 * download (preview). Cancelling the dialog is not an error.
 */
export async function exportProfileToFile(profile: CustomProfile): Promise<ProfileFileResult> {
  const filename = suggestProfileFileName(profile);
  const contents = serializeCustomProfile(profile);
  if (isTauri) {
    try {
      const { save } = await import("@tauri-apps/plugin-dialog");
      const path = await save({
        defaultPath: filename,
        filters: [{ name: "Sophos custom profile", extensions: ["json"] }],
      });
      if (path === null) return { ok: false, cancelled: true };
      const written = await writeViaTauri(path, contents);
      if (!written.ok) return written;
      return { ok: true, detail: `Saved to ${path}` };
    } catch (err) {
      return { ok: false, cancelled: false, error: `Could not open the save dialog: ${err instanceof Error ? err.message : String(err)}` };
    }
  }
  return downloadInBrowser(contents, filename);
}

/**
 * Pick a profile file through the NATIVE open dialog (Tauri) or a file input
 * (preview). Returns the raw file text — parsing is the caller's job.
 */
export async function importProfileFromFile(): Promise<ProfileFileResult & { text?: string }> {
  if (isTauri) {
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const path = await open({
        multiple: false,
        directory: false,
        filters: [{ name: "Sophos custom profile", extensions: ["json"] }],
      });
      if (path === null) return { ok: false, cancelled: true };
      const read = await readViaTauri(path);
      if (!read.ok) return read;
      return { ok: true, detail: path, text: read.text };
    } catch (err) {
      return { ok: false, cancelled: false, error: `Could not open the file dialog: ${err instanceof Error ? err.message : String(err)}` };
    }
  }
  return pickInBrowser();
}
