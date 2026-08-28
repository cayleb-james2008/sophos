// MigrationWizard — the UI for bringing an existing Claude Desktop / Codex
// Desktop setup into Sophos.
//
// It is deliberately honest:
//   * You can paste (or pick) a CLAUDE.md and/or a Claude/Codex config.
//   * A live preview shows exactly what will become Settings vs a suggested
//     custom profile before anything is written.
//   * "Import" calls setSettings with the merged patch and saves a custom
//     profile through the studio store helpers. Bad input shows a plain error
//     and NEVER crashes the app.
//
// Design: near-black surfaces, one sage/terminal-green accent (var(--pa-green)),
// hairline borders (var(--pa-border)), 0px radius — see migration.css.

import { useMemo, useState } from "react";
import { useIpc, isTauri } from "../../ipc/client";
import type { Settings } from "../../ipc/contract";
import type { ProfileMode } from "../profiles/profiles";
import {
  CUSTOM_PROFILES_SETTINGS_KEY,
  createCustomProfileDraft,
  newCustomProfileId,
  parseCustomProfiles,
  sanitizeCustomProfile,
  type CustomProfile,
} from "../studio/store";
import {
  mergeImportResults,
  parseClaudeConfig,
  parseClaudeMd,
  parseCodexConfig,
  type ImportResult,
} from "./import";
import "./migration.css";

/** Read a file the user picked — native dialog in Tauri, file input otherwise. */
async function pickFile(accept: string): Promise<string | null> {
  if (isTauri) {
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const picked = await open({
        multiple: false,
        directory: false,
        filters: [{ name: "Config", extensions: ["json", "toml", "md", "txt"] }],
      });
      if (!picked) return null;
      const path = Array.isArray(picked) ? picked[0] : picked;
      const { invoke } = await import("@tauri-apps/api/core");
      return await invoke<string>("read_text_file", { path });
    } catch (err) {
      console.error("Migration file picker failed:", err);
      return null;
    }
  }

  if (typeof document === "undefined") return null;
  return new Promise<string | null>((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.onchange = () => {
      const file = input.files && input.files[0];
      if (!file) {
        resolve(null);
        return;
      }
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result ?? ""));
      reader.onerror = () => resolve(null);
      reader.readAsText(file);
    };
    input.click();
  });
}

function clamp(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max).trimEnd()}…`;
}

export function MigrationWizard() {
  const ipc = useIpc();
  const [claudeMdText, setClaudeMdText] = useState("");
  const [claudeJsonText, setClaudeJsonText] = useState("");
  const [codexText, setCodexText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const claudeMd = useMemo(() => parseClaudeMd(claudeMdText), [claudeMdText]);

  const claudeResult = useMemo<ImportResult | null>(() => {
    if (!claudeJsonText.trim()) return null;
    let obj: unknown;
    try {
      obj = JSON.parse(claudeJsonText);
    } catch {
      const fallback = parseClaudeConfig({});
      return { ...fallback, notes: ["Claude config text is not valid JSON — fix it or clear the field."] };
    }
    return parseClaudeConfig(obj);
  }, [claudeJsonText]);

  const codexResult = useMemo<ImportResult | null>(
    () => (codexText.trim() ? parseCodexConfig(codexText) : null),
    [codexText],
  );

  const combined = useMemo(
    () => mergeImportResults([claudeResult, codexResult].filter((r): r is ImportResult => r !== null)),
    [claudeResult, codexResult],
  );

  const canImport = Boolean(claudeMdText.trim() || claudeJsonText.trim() || codexText.trim());

  async function loadClaudeMd() {
    const text = await pickFile(".md,.txt");
    if (text !== null) setClaudeMdText(text);
  }
  async function loadClaudeConfig() {
    const text = await pickFile(".json");
    if (text !== null) setClaudeJsonText(text);
  }
  async function loadCodex() {
    const text = await pickFile(".json,.toml");
    if (text !== null) setCodexText(text);
  }

  async function handleImport() {
    setError(null);
    setStatus(null);
    setBusy(true);
    try {
      const base = (await ipc.getSettings().catch(() => ({}))) as Settings & {
        customProfiles?: unknown;
      };
      const merged = { ...base, ...combined.settingsPatch } as Settings;

      const sp = combined.suggestedProfile;
      const draft = createCustomProfileDraft({
        name: sp.name,
        tagline: sp.tagline,
        workingStyle: sp.workingStyle,
        mode: sp.mode as ProfileMode,
        safety: sp.safety,
      });
      const profile: CustomProfile = sanitizeCustomProfile(draft);
      if (claudeMd.instructions) {
        profile.systemPrompt = claudeMd.instructions;
      }
      profile.id = newCustomProfileId();

      const existing = parseCustomProfiles(base.customProfiles);
      const usedNames = existing.map((p) => p.name.toLowerCase());
      let finalName = sp.name;
      let i = 1;
      while (usedNames.includes(finalName.toLowerCase())) {
        i += 1;
        finalName = `${sp.name} (${i})`;
      }
      profile.name = finalName;

      const finalSettings = {
        ...merged,
        [CUSTOM_PROFILES_SETTINGS_KEY]: [...existing, profile],
      } as Settings;

      await ipc.setSettings(finalSettings);

      const bits: string[] = [];
      if (combined.settingsPatch.defaultModel) bits.push(`model "${combined.settingsPatch.defaultModel}"`);
      if (combined.settingsPatch.auth)
        bits.push(`${Object.keys(combined.settingsPatch.auth).length} API key(s)`);
      if (combined.settingsPatch.mcpServers)
        bits.push(`${combined.settingsPatch.mcpServers.length} MCP server(s)`);
      const patchText = bits.length ? ` and set ${bits.join(", ")}` : "";
      setStatus(
        `Imported${patchText}. Created custom profile “${finalName}”${claudeMd.instructions ? " with your CLAUDE.md instructions" : ""}. Review it in the Profile Studio.`,
      );
    } catch (err) {
      console.error("Migration import failed:", err);
      setError(
        err instanceof Error
          ? `Import failed: ${err.message}`
          : "Import failed for an unknown reason. Your existing settings were not changed.",
      );
    } finally {
      setBusy(false);
    }
  }

  const patch = combined.settingsPatch;
  const profile = combined.suggestedProfile;
  const authKeys = patch.auth ? Object.keys(patch.auth) : [];
  const mcpCount = patch.mcpServers ? patch.mcpServers.length : 0;

  return (
    <div className="mig">
      <div>
        <h3 className="mig__title">Import from Claude Desktop / Codex Desktop</h3>
        <p className="mig__subtitle">
          Paste your existing setup below. Sophos maps it to your Settings and a custom profile — nothing is
          written until you press Import. Hooks and approval policies are noted, not auto-applied.
        </p>
      </div>

      <div className="mig__sources">
        <div className="mig__source">
          <div className="mig__source-head">
            <span className="mig__source-label">CLAUDE.md</span>
            <button type="button" className="mig__file-btn" onClick={loadClaudeMd} disabled={busy}>
              Load file…
            </button>
          </div>
          <textarea
            className="mig__textarea"
            aria-label="CLAUDE.md instructions"
            placeholder="Paste the contents of your CLAUDE.md (agent instructions)…"
            value={claudeMdText}
            onChange={(e) => setClaudeMdText(e.target.value)}
          />
          <span className="mig__hint">
            {claudeMd.instructions
              ? `Will become the custom profile instructions (${claudeMd.instructions.length} chars).`
              : "Optional. Becomes the profile agent instructions."}
          </span>
        </div>

        <div className="mig__source">
          <div className="mig__source-head">
            <span className="mig__source-label">~/.claude.json</span>
            <button type="button" className="mig__file-btn" onClick={loadClaudeConfig} disabled={busy}>
              Load file…
            </button>
          </div>
          <textarea
            className="mig__textarea"
            aria-label="Claude config JSON"
            placeholder="Paste ~/.claude.json (for example: model, mcpServers, auth)…"
            value={claudeJsonText}
            onChange={(e) => setClaudeJsonText(e.target.value)}
          />
          <span className="mig__hint">Optional. Maps model, API keys, and MCP servers.</span>
        </div>

        <div className="mig__source">
          <div className="mig__source-head">
            <span className="mig__source-label">Codex config</span>
            <button type="button" className="mig__file-btn" onClick={loadCodex} disabled={busy}>
              Load file…
            </button>
          </div>
          <textarea
            className="mig__textarea"
            aria-label="Codex config (JSON or TOML)"
            placeholder="Paste ~/.codex/config.json or config.toml…"
            value={codexText}
            onChange={(e) => setCodexText(e.target.value)}
          />
          <span className="mig__hint">Optional. Accepts JSON or minimal TOML.</span>
        </div>
      </div>

      <div className="mig__preview">
        <div className="mig__preview-title">Live preview — what will be imported</div>
        <dl className="mig__kv">
          <dt>Default model</dt>
          <dd>
            {patch.defaultModel
              ? `${patch.defaultProvider ? `${patch.defaultProvider}/` : ""}${patch.defaultModel}`
              : "— (unchanged)"}
          </dd>
          <dt>API keys</dt>
          <dd>{authKeys.length ? `${authKeys.join(", ")} (carried over as-is)` : "— (unchanged)"}</dd>
          <dt>MCP servers</dt>
          <dd>{mcpCount ? `${mcpCount} server(s)` : "— (none)"}</dd>
          <dt>Profile name</dt>
          <dd>{profile.name}</dd>
          <dt>Profile mode</dt>
          <dd>{profile.mode}</dd>
          <dt>Tools hint</dt>
          <dd>{profile.toolsHint}</dd>
          <dt>Safety</dt>
          <dd>
            {profile.safety.autoApprove
              ? "auto-approve safe tools"
              : `confirm: ${profile.safety.confirm.join(", ") || "nothing"}`}
          </dd>
          <dt>Working style</dt>
          <dd>{profile.workingStyle.join("; ")}</dd>
        </dl>
        {claudeMd.instructions ? (
          <span className="mig__hint">
            CLAUDE.md instructions (first 200 chars): {clamp(claudeMd.instructions, 200)}
          </span>
        ) : null}
      </div>

      {combined.notes.length > 0 ? (
        <ul className="mig__notes">
          {combined.notes.map((note, idx) => (
            <li key={idx}>{note}</li>
          ))}
        </ul>
      ) : null}

      {error ? <div className="mig__error">{error}</div> : null}
      {status ? <div className="mig__status">{status}</div> : null}

      <div className="mig__actions">
        <button
          type="button"
          className="mig__import-btn"
          onClick={handleImport}
          disabled={!canImport || busy}
        >
          {busy ? "Importing…" : "Import"}
        </button>
        {!canImport ? (
          <span className="mig__hint">Paste at least one source above to enable Import.</span>
        ) : null}
      </div>
    </div>
  );
}
