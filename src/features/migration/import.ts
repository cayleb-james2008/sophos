// migration/import — PURE, DOM-free parsers that translate a user's existing
// Claude Desktop / Codex Desktop setup into a Sophos-friendly shape.
//
// Everything here is defensive: malformed JSON, foreign shapes, missing fields,
// and garbage input all return a clear `notes` array with an empty/partial
// result. NOTHING in this module ever throws — the UI surfaces the notes and
// never crashes. Parsers have no access to `window`, `document`, or Tauri, so
// they run unchanged in vitest (node) and in the browser.

import type { Settings } from "../../ipc/contract";

/** A normalized MCP server discovered in a source config. */
export interface McpServerConfig {
  name: string;
  command: string;
  args: string[];
  enabled: boolean;
}

/** The runtime mode a suggested custom profile should run in. */
export type ImportProfileMode = "standard" | "minimal" | "creator" | "code";

/**
 * The custom profile the wizard will create. Carries exactly the fields the
 * contract requires (name / tagline / workingStyle / mode / toolsHint / safety)
 * plus an optional `instructions` slot so the wizard can show the CLAUDE.md
 * body it will fold into the profile.
 */
export interface ImportedProfile {
  name: string;
  tagline: string;
  workingStyle: string[];
  mode: ImportProfileMode;
  toolsHint: string;
  safety: { autoApprove: boolean; confirm: string[] };
  /** Optional raw instruction body (from CLAUDE.md) the wizard will carry over. */
  instructions?: string;
}

/**
 * The full output of a parse: a partial Settings patch (merged by the caller),
 * a suggested custom profile, and a human-readable notes list.
 *
 * `mcpServers` is an ADDITIVE settings key — the bridge merges unknown keys and
 * the daemon ignores them, so it rides along on `settingsPatch` even though it
 * is not a typed `Settings` field. This mirrors how `agentProfile` and
 * `disabledSkills` already work.
 */
export interface ImportResult {
  settingsPatch: Partial<Settings> & { mcpServers?: McpServerConfig[] };
  suggestedProfile: ImportedProfile;
  notes: string[];
}

// ---------------------------------------------------------------------------
// Small guarded accessors
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
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

// ---------------------------------------------------------------------------
// CLAUDE.md
// ---------------------------------------------------------------------------

/**
 * Extract the instruction body from a CLAUDE.md. Claude Desktop's CLAUDE.md is
 * plain prose agent instructions, so we keep the trimmed text verbatim — the
 * wizard folds it into the custom profile's instructions. Empty/missing input
 * is reported, never thrown.
 */
export function parseClaudeMd(text: unknown): { instructions: string; notes: string[] } {
  const notes: string[] = [];
  if (typeof text !== "string") {
    return { instructions: "", notes: ["CLAUDE.md input was not text — nothing to import."] };
  }
  const instructions = text.trim();
  if (!instructions) {
    notes.push("CLAUDE.md was empty — no instructions were imported.");
  }
  return { instructions, notes };
}

// ---------------------------------------------------------------------------
// Shared field extraction
// ---------------------------------------------------------------------------

/** Map a model string, optionally splitting a "provider/model" form. */
function extractModel(obj: Record<string, unknown>): { provider?: string; model?: string; note: string } {
  const raw = asString(obj.model);
  if (!raw) return { note: "" };
  if (raw.includes("/")) {
    const idx = raw.indexOf("/");
    const provider = raw.slice(0, idx).trim();
    const model = raw.slice(idx + 1).trim();
    return {
      provider: provider || undefined,
      model: model || undefined,
      note: `Model set to ${model || raw}${provider ? ` (provider ${provider})` : ""}.`,
    };
  }
  return { model: raw, note: `Model set to ${raw}.` };
}

/**
 * Collect provider→API-key pairs from the common shapes (a top-level `auth`
 * object, a top-level `providers` object, or a Codex-style `providers` whose
 * value is `{ apiKey }`). Non-string key values are SKIPPED (never thrown),
 * matching the contract's "provider→key only" rule. Values are copied as-is;
 * the caller is responsible for confirming before trusting them.
 */
function extractAuth(obj: Record<string, unknown>): Record<string, string> {
  const auth: Record<string, string> = {};

  const accept = (source: unknown) => {
    if (!isRecord(source)) return;
    for (const [provider, value] of Object.entries(source)) {
      if (typeof value === "string" && value.trim()) {
        auth[provider] = value;
      } else if (isRecord(value) && typeof value.apiKey === "string" && value.apiKey.trim()) {
        // Codex provider shape: { "openai": { "apiKey": "..." } }
        auth[provider] = value.apiKey as string;
      }
      // Any other (non-string) shape is skipped silently — defensive, no throw.
    }
  };

  accept(obj.auth);
  accept(obj.providers);
  return auth;
}

/**
 * Normalize an mcpServers value (object map OR array) into a clean array of
 * { name, command, args, enabled }. Claude/Codex both use one of these two
 * shapes; we accept either and never throw on a stray entry.
 */
function extractMcpServers(raw: unknown): McpServerConfig[] {
  const out: McpServerConfig[] = [];
  if (!raw) return out;

  const pushOne = (name: string, value: unknown) => {
    if (!name || !isRecord(value)) return;
    out.push({
      name,
      command: asString(value.command),
      args: asStringArray(value.args),
      enabled: value.enabled === undefined ? true : value.enabled !== false,
    });
  };

  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (isRecord(item)) pushOne(asString(item.name), item);
    }
  } else if (isRecord(raw)) {
    for (const [name, value] of Object.entries(raw)) {
      pushOne(name, value);
    }
  }
  return out;
}

/** Build the suggested custom-profile skeleton shared by both sources. */
function baseSuggestedProfile(sourceLabel: string): ImportedProfile {
  return {
    name: `Imported from ${sourceLabel}`,
    tagline: `Migrated from ${sourceLabel}`,
    workingStyle: ["Bring-your-own instructions", "Provider keys carried over", "MCP servers attached"],
    mode: "standard",
    toolsHint: "Standard toolset (shell, file editor, file search, web search, kernel, refine)",
    safety: { autoApprove: false, confirm: ["Destructive shell"] },
  };
}

// ---------------------------------------------------------------------------
// Claude Desktop config (~/.claude.json)
// ---------------------------------------------------------------------------

/**
 * Parse a `~/.claude.json`-shaped object. Never throws: a non-object input or
 * any missing field degrades to an empty patch + an explanatory note.
 */
export function parseClaudeConfig(json: unknown): ImportResult {
  const notes: string[] = [];
  const patch: Partial<Settings> & { mcpServers?: McpServerConfig[] } = {};
  const suggested = baseSuggestedProfile("Claude Desktop");

  if (!isRecord(json)) {
    notes.push(
      "The Claude config was not a recognizable object — nothing was imported. Check that you pasted the full ~/.claude.json.",
    );
    return { settingsPatch: patch, suggestedProfile: suggested, notes };
  }

  const model = extractModel(json);
  if (model.model) {
    patch.defaultModel = model.model;
    if (model.provider) patch.defaultProvider = model.provider;
    notes.push(model.note);
  }

  const auth = extractAuth(json);
  if (Object.keys(auth).length > 0) {
    patch.auth = auth;
    const keys = Object.keys(auth).join(", ");
    notes.push(
      `Mapped ${Object.keys(auth).length} provider API key(s) into Settings auth (${keys}). Verify them in Settings before trusting — imported keys are carried over as-is.`,
    );
  }

  const mcp = extractMcpServers(json.mcpServers);
  if (mcp.length > 0) {
    patch.mcpServers = mcp;
    notes.push(`Imported ${mcp.length} MCP server(s) into Settings (mcpServers).`);
  }

  // Hooks are deliberately NOT auto-imported — honest about the gap.
  if (json.hooks !== undefined) {
    notes.push(
      "Hooks found in ~/.claude.json are NOT imported automatically. Sophos has no hook runner yet — re-create any startup/event behavior you need in Settings or the Profile Studio.",
    );
  }

  if (notes.length === 0) {
    notes.push("Parsed ~/.claude.json, but found no model, API keys, or MCP servers to import.");
  }

  return { settingsPatch: patch, suggestedProfile: suggested, notes };
}

// ---------------------------------------------------------------------------
// Codex Desktop config (~/.codex/config.json or config.toml)
// ---------------------------------------------------------------------------

/**
 * Parse a Codex config given as either an already-parsed object or a raw string
 * (JSON or minimal TOML). Never throws: bad input yields an empty patch + note.
 */
export function parseCodexConfig(input: string | unknown): ImportResult {
  const notes: string[] = [];
  const patch: Partial<Settings> & { mcpServers?: McpServerConfig[] } = {};
  const suggested = baseSuggestedProfile("Codex Desktop");

  let obj: unknown;
  if (typeof input === "string") {
    const text = input.trim();
    if (!text) {
      notes.push("The Codex config was empty — nothing to import.");
      return { settingsPatch: patch, suggestedProfile: suggested, notes };
    }
    if (text.startsWith("{")) {
      try {
        obj = JSON.parse(text);
      } catch {
        notes.push(
          "The Codex config looked like JSON but could not be parsed — check for a missing comma or quote.",
        );
        return { settingsPatch: patch, suggestedProfile: suggested, notes };
      }
    } else {
      obj = parseTomlMinimal(text);
      if (!isRecord(obj) || Object.keys(obj).length === 0) {
        notes.push(
          "The Codex config looked like TOML but could not be parsed — only simple key/value and [table] shapes are supported.",
        );
        return { settingsPatch: patch, suggestedProfile: suggested, notes };
      }
    }
  } else {
    obj = input;
  }

  if (!isRecord(obj)) {
    notes.push("The Codex config was not a recognizable object — nothing was imported.");
    return { settingsPatch: patch, suggestedProfile: suggested, notes };
  }

  const model = extractModel(obj);
  if (model.model) {
    patch.defaultModel = model.model;
    if (model.provider) patch.defaultProvider = model.provider;
    notes.push(model.note);
  }

  const auth = extractAuth(obj);
  if (Object.keys(auth).length > 0) {
    patch.auth = auth;
    const keys = Object.keys(auth).join(", ");
    notes.push(
      `Mapped ${Object.keys(auth).length} provider API key(s) into Settings auth (${keys}). Verify them in Settings before trusting — imported keys are carried over as-is.`,
    );
  }

  const mcp = extractMcpServers(obj.mcpServers);
  if (mcp.length > 0) {
    patch.mcpServers = mcp;
    notes.push(`Imported ${mcp.length} MCP server(s) into Settings (mcpServers).`);
  }

  // Codex approval policy maps to nothing automatic — noted as manual.
  const approval = asString(obj.approvalPolicy) || asString(obj.approval_policy) || asString(obj.approval);
  if (approval) {
    notes.push(
      `Codex approval policy "${approval}" was read but is NOT auto-applied. Set your confirm rules per profile in the Profile Studio.`,
    );
  }

  if (notes.length === 0) {
    notes.push("Parsed the Codex config, but found no model, API keys, or MCP servers to import.");
  }

  return { settingsPatch: patch, suggestedProfile: suggested, notes };
}

// ---------------------------------------------------------------------------
// Minimal TOML parser (best-effort, never throws)
// ---------------------------------------------------------------------------

/** Find the first unquoted occurrence of `needle` in `line`. */
function indexOfUnquoted(line: string, needle: string): number {
  let inStr = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') inStr = !inStr;
    else if (!inStr && line.startsWith(needle, i)) return i;
  }
  return -1;
}

/** Find the index of the closing `"` in a basic string, honoring backslash escapes. */
function findClosingQuote(s: string): number {
  for (let i = 0; i < s.length; i += 1) {
    const ch = s[i];
    if (ch === "\\") {
      i += 1; // skip the escaped character
      continue;
    }
    if (ch === '"') return i;
  }
  return -1;
}

/** Parse a TOML value: string, integer, float, boolean, or array. */
function parseTomlValue(raw: string): unknown {
  const v = raw.trim();
  if (!v) return "";
  if (v.startsWith('"')) {
    const inner = v.slice(1);
    const end = findClosingQuote(inner);
    if (end < 0) return v;
    return inner.slice(0, end).replace(/\\"/g, '"').replace(/\\\\/g, "\\");
  }
  if (v.startsWith("[") && v.endsWith("]")) {
    const inner = v.slice(1, -1).trim();
    if (!inner) return [];
    return inner.split(",").map((part) => parseTomlValue(part.trim()));
  }
  if (v === "true") return true;
  if (v === "false") return false;
  if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
  return v; // bare string / datetime left as-is
}

/**
 * A deliberately small TOML reader: top-level scalars, `#` comments, `[table]`
 * and `[[array-of-tables]]` with dotted paths, and basic arrays. It covers the
 * Codex `config.toml` shapes we care about and degrades to `{}` on anything it
 * cannot make sense of. It NEVER throws.
 */
function parseTomlMinimal(text: string): Record<string, unknown> {
  try {
    const root: Record<string, unknown> = {};
    let active: string[] = [];

    const resolve = (parts: string[]): Record<string, unknown> => {
      let node: Record<string, unknown> = root;
      for (const seg of parts) {
        if (typeof node[seg] !== "object" || node[seg] === null || Array.isArray(node[seg])) {
          node[seg] = {};
        }
        node = node[seg] as Record<string, unknown>;
      }
      return node;
    };

    for (const rawLine of text.split(/\r?\n/)) {
      const hash = indexOfUnquoted(rawLine, "#");
      const line = (hash >= 0 ? rawLine.slice(0, hash) : rawLine).trim();
      if (!line) continue;

      if (line.startsWith("[")) {
        let header = line.slice(1);
        let arrayOfTables = false;
        if (header.startsWith("[")) {
          arrayOfTables = true;
          header = header.slice(1);
        }
        const close = header.lastIndexOf("]");
        if (close < 0) continue;
        header = header.slice(0, close);
        const parts = header
          .split(".")
          .map((s) => s.trim())
          .filter(Boolean);
        if (parts.length === 0) continue;

        if (arrayOfTables) {
          // [[a.b]] → ensure root.a is an array of tables, push a new entry,
          // and point `active` at that new entry's path.
          const parentParts = parts.slice(0, -1);
          const key = parts[parts.length - 1];
          const parent = resolve(parentParts);
          const arr = Array.isArray(parent[key]) ? (parent[key] as unknown[]) : [];
          const entry: Record<string, unknown> = {};
          arr.push(entry);
          parent[key] = arr;
          active = [...parentParts, key, String(arr.length - 1)];
        } else {
          resolve(parts);
          active = parts;
        }
        continue;
      }

      const eq = indexOfUnquoted(line, "=");
      if (eq < 0) continue;
      const key = line.slice(0, eq).trim();
      const valueStr = line.slice(eq + 1).trim();
      if (!key) continue;
      resolve(active)[key] = parseTomlValue(valueStr);
    }
    return root;
  } catch {
    return {};
  }
}

// ---------------------------------------------------------------------------
// Combine multiple results (the wizard may import from several sources)
// ---------------------------------------------------------------------------

/**
 * Merge several ImportResults into one. Later sources win on scalar conflicts
 * (model/provider), auth keys are unioned, MCP servers are concatenated, and
 * notes are collected in order. Used by the wizard when the user pastes both a
 * Claude and a Codex config.
 */
export function mergeImportResults(results: ImportResult[]): ImportResult {
  const patch: Partial<Settings> & { mcpServers?: McpServerConfig[] } = {};
  const auth: Record<string, string> = {};
  const mcp: McpServerConfig[] = [];
  const notes: string[] = [];
  let suggested: ImportedProfile | null = null;

  for (const r of results) {
    const p = r.settingsPatch;
    if (p.defaultModel) patch.defaultModel = p.defaultModel;
    if (p.defaultProvider) patch.defaultProvider = p.defaultProvider;
    if (p.auth) Object.assign(auth, p.auth);
    if (p.mcpServers) mcp.push(...p.mcpServers);
    if (r.suggestedProfile) suggested = r.suggestedProfile;
    notes.push(...r.notes);
  }

  if (Object.keys(auth).length > 0) patch.auth = auth;
  if (mcp.length > 0) patch.mcpServers = mcp;

  return {
    settingsPatch: patch,
    suggestedProfile: suggested ?? baseSuggestedProfile("Claude / Codex Desktop"),
    notes,
  };
}
