// demoTurn — deterministic demo run_code program for Code Mode (v0.7.1).
//
// Demo mode has no sandboxed TypeScript runtime (the daemon contract has no
// such seam — documented in CHANGELOG/README as the known limitation), so
// run_code programs are SIMULATED. To keep the demo honest and testable:
//
//   * buildCodeModeTurn(text) deterministically derives a program from the
//     user's ACTUAL input — same input ⇒ same program and same tool calls;
//   * decomposeProgram(program) is a pure function that turns one program
//     into its individual tool calls, so the decomposition the UI shows is
//     the same decomposition a test can assert;
//   * every simulated tool output is clearly labeled as demo/simulated —
//     nothing claims a live tool ran.

/** One tool call inside a demo program, in SDK-call order. */
export interface DemoToolCall {
  name: string;
  input: Record<string, unknown>;
  output: string;
}

/** Truncate long user input so the program stays readable and deterministic. */
function shortText(text: string, max = 80): string {
  const t = text.trim();
  if (!t) return "(empty message)";
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

/**
 * Build the deterministic demo run_code program + its individual tool calls
 * from the user's input. Same input ⇒ byte-identical program and identical
 * call sequence (no timestamps, no randomness).
 */
export function buildCodeModeTurn(text: string): { program: string; calls: DemoToolCall[] } {
  const goal = shortText(text);
  const calls: DemoToolCall[] = [
    {
      name: "readFile",
      input: { path: "src/features/code/sdk.ts" },
      output: "Read 31 lines — typed stubs for every registered tool.",
    },
    {
      name: "searchFiles",
      input: { pattern: "run_code" },
      output: "3 matches in src/features/code.",
    },
    {
      name: "webSearch",
      input: { query: goal },
      output: `Demo: no live web search in demo mode — would search “${goal}”.`,
    },
    {
      name: "refine",
      input: { prompt: goal },
      output: "Plan refined — verified tool availability before building.",
    },
  ];

  const program = [
    "// Code Mode demo program — one program, many tool calls (simulated).",
    `// Goal: ${goal}`,
    'import { readFile, searchFiles, webSearch, refine } from "./sdk";',
    "",
    'const spec = await readFile({ path: "src/features/code/sdk.ts" });',
    'const hits = await searchFiles({ pattern: "run_code" });',
    `const context = await webSearch({ query: ${JSON.stringify(goal)} });`,
    `await refine({ prompt: ${JSON.stringify(goal)} });`,
    "",
  ].join("\n");

  return { program, calls };
}

/**
 * Parse one `{...}` argument literal. JSON.parse first (quoted keys); on
 * failure, quote bare JS-object keys (the shape TypeScript programs use) and
 * retry; on failure, return the raw text — the decomposition degrades,
 * never throws.
 */
function parseArgObject(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    // JS object literal with unquoted keys, e.g. { pattern: "run_code" }.
    const normalized = raw.replace(/(\{|,)\s*([A-Za-z_$][A-Za-z0-9_$]*)\s*:/g, '$1 "$2":');
    try {
      return JSON.parse(normalized);
    } catch {
      return raw;
    }
  }
}

/**
 * Pure decomposition: parse one program into its individual tool calls.
 * Recognizes `await fnName({...})` / `fnName({...})` invocations and extracts
 * the first argument object as a parsed input (degrading to the raw text when
 * the object isn't parseable). Used by the run view, the trajectory summary,
 * and the tests — the same decomposition everywhere.
 */
export function decomposeProgram(program: string): Array<{ name: string; input: unknown }> {
  const out: Array<{ name: string; input: unknown }> = [];
  const re = /(?:await\s+)?([A-Za-z_$][A-Za-z0-9_$]*)\s*\(\s*(\{[\s\S]*?\})\s*\)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(program)) !== null) {
    out.push({ name: match[1], input: parseArgObject(match[2]) });
  }
  return out;
}
