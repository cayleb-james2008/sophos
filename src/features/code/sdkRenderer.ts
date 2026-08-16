// sdkRenderer — the deterministic TypeScript SDK renderer (v0.7.1).
//
// Turns the Code Mode tool registry into a ready-made toolkit of typed
// TypeScript stubs. The agent writes ONE program that calls many tools in a
// single step; each stub declares the runtime contract (typed arguments) that
// the agent runtime executes.
//
// Determinism contract:
//   * input order is irrelevant — entries are sorted lexicographically by name
//     inside the renderer, so an unchanged tool set always produces
//     byte-identical output;
//   * unsupported or malformed schemas DEGRADE to a permissive contract
//     (`Record<string, unknown>` / `unknown`) instead of throwing;
//   * only erasable TypeScript syntax is emitted (type annotations, object
//     type literals, JSDoc), so stripping types yields valid JavaScript —
//     the "type-stripped contract" covered by the tests.

import type { ParamSpec, ToolRegistryEntry, ToolSchema } from "./toolRegistry";
import { sortEntries } from "./toolRegistry";

export interface SdkRenderOptions {
  /** Emit plain JavaScript (no type annotations) instead of typed stubs. */
  stripTypes?: boolean;
}

/** Convert a tool name to a valid camelCase TS identifier. Deterministic:
 * lowercased words, first word lower, subsequent words capitalized; a
 * leading non-letter gets a `tool` prefix so the result is always a legal
 * identifier. */
export function toIdent(name: string | undefined): string {
  const words = (name ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter((w) => w.length > 0);
  const base = words.map((w, i) => (i === 0 ? w : w[0].toUpperCase() + w.slice(1))).join("");
  return /^[a-z]/.test(base) ? base : `tool${base}`;
}

function isIdentifier(value: string): boolean {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(value);
}

/** Map one parameter spec to its TypeScript type. Anything unrecognized
 * degrades to `unknown` — never throws. */
export function propType(spec: ParamSpec | undefined): string {
  if (!spec || typeof spec !== "object" || Array.isArray(spec)) return "unknown";
  switch (spec.type) {
    case "string":
      return "string";
    case "number":
    case "integer":
      return "number";
    case "boolean":
      return "boolean";
    case "array":
      return `Array<${propType(spec.items ? { type: spec.items.type } : undefined)}>`;
    case "object":
      return "Record<string, unknown>";
    default:
      return "unknown";
  }
}

/** Render a tool's argument contract as a TS type. Malformed or unsupported
 * schemas degrade to `Record<string, unknown>`; empty objects too (a tool
 * with no declared parameters is still called with a permissive bag). */
export function toParamType(schema: ToolSchema | undefined): string {
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) return "Record<string, unknown>";
  if (schema.type !== "object") return "unknown";
  const props = schema.properties;
  if (!props || typeof props !== "object" || Array.isArray(props)) return "Record<string, unknown>";
  const keys = Object.keys(props).sort();
  if (keys.length === 0) return "Record<string, unknown>";
  const required = Array.isArray(schema.required) ? new Set(schema.required) : new Set<string>();
  const parts = keys.map((key) => {
    // Property names that aren't valid identifiers are quoted — still legal TS.
    const renderedKey = isIdentifier(key) ? key : JSON.stringify(key);
    return `${renderedKey}${required.has(key) ? "" : "?"}: ${propType(props[key])}`;
  });
  return `{ ${parts.join("; ")} }`;
}

/** Render one stub. `usedIdents` tracks identifiers so colliding tool names
 * get a numeric suffix deterministically. */
export function renderStub(entry: ToolRegistryEntry, usedIdents: Set<string>, options: SdkRenderOptions = {}): string {
  let ident = toIdent(entry?.name);
  if (usedIdents.has(ident)) {
    let suffix = 2;
    while (usedIdents.has(`${ident}${suffix}`)) suffix += 1;
    ident = `${ident}${suffix}`;
  }
  usedIdents.add(ident);

  const desc = (entry.description ?? "No description").replace(/\*\//g, "*\\/");
  const origin = entry.source ? ` from ${entry.source}` : "";
  const lines: string[] = [`/** ${desc} (${entry.category}${origin}) */`];
  if (options.stripTypes) {
    lines.push(
      `export async function ${ident}(args) {`,
      `  throw new Error("SDK stub — executed by the agent runtime, not in-process");`,
      `}`,
    );
  } else {
    lines.push(
      `export async function ${ident}(args: ${toParamType(entry.schema)}): Promise<unknown> {`,
      `  throw new Error("SDK stub — executed by the agent runtime, not in-process");`,
      `}`,
    );
  }
  return lines.join("\n");
}

/**
 * Render the full SDK source for a registry. Deterministic: entries are
 * sorted lexicographically inside, so the same tool set always yields the
 * same bytes regardless of caller order.
 */
export function renderSdk(entries: ToolRegistryEntry[], options: SdkRenderOptions = {}): string {
  const sorted = sortEntries(entries);
  const usedIdents = new Set<string>();
  const stubs = sorted.map((entry) => renderStub(entry, usedIdents, options));

  const total = sorted.length;
  const builtin = sorted.filter((e) => e.category === "builtin").length;
  const extension = sorted.filter((e) => e.category === "extension").length;
  const mcp = sorted.filter((e) => e.category === "mcp").length;
  const skill = sorted.filter((e) => e.category === "skill").length;

  const head = [
    "// Sophos Code Mode — typed tool SDK (generated, deterministic).",
    "// One program calls many tools in a single step. Each stub declares the",
    "// runtime contract; the agent runtime executes it (in demo mode the run is",
    "// simulated and decomposed into tool-call cards).",
    `// ${total} tools · builtin ${builtin} · extension ${extension} · mcp ${mcp} · skill ${skill}`,
    "// Tool order: lexicographic by name.",
    "",
  ].join("\n");

  return head + stubs.join("\n\n") + "\n";
}
