// diff — a tiny, dependency-free line diff for file-edit tool calls.
//
// Computes a longest-common-subsequence (LCS) line diff between a "before"
// and "after" text, and formats it as a unified diff. No external libraries —
// the app must stay offline-capable, so the algorithm is self-contained here.
//
// Also owns the file-edit *detection* logic: given a tool call's name and raw
// input string, decide whether it is a file edit and, if so, extract the file
// path plus the before/after text to diff.

export type DiffLineType = "add" | "remove" | "context";

export interface DiffLine {
  type: DiffLineType;
  text: string;
}

export interface FileEdit {
  filePath: string;
  before: string;
  after: string;
  isNewFile: boolean;
}

// Guard: for very large inputs the O(n*m) LCS table would be too heavy. Above
// this many lines we fall back to a coarse whole-file replace diff (every old
// line removed, every new line added) — still correct, just not minimal.
const MAX_LCS_LINES = 2000;

// Tool names that are, by convention, file-edit operations. Detection also
// falls back to the input shape (file_path+content / old_string+new_string),
// so tools with unusual names still get a diff when their input is shaped like
// an edit.
const EDIT_TOOL_NAMES = new Set([
  "write_file",
  "edit_file",
  "str_replace",
  "str_replace_editor",
  "patch",
  "write",
]);

export function isEditToolName(name: string): boolean {
  return EDIT_TOOL_NAMES.has(name);
}

function splitLines(text: string): string[] {
  // Normalize CRLF; a trailing newline does not produce a phantom empty line.
  const normalized = text.replace(/\r\n/g, "\n");
  if (normalized === "") return [];
  return normalized.split("\n");
}

/**
 * Compute the LCS line diff between two strings. Returns an ordered list of
 * lines tagged add / remove / context.
 */
export function diffLines(before: string, after: string): DiffLine[] {
  const a = splitLines(before);
  const b = splitLines(after);

  // Whole-file replace fallback for pathological sizes.
  if (a.length > MAX_LCS_LINES || b.length > MAX_LCS_LINES) {
    const out: DiffLine[] = [];
    for (const line of a) out.push({ type: "remove", text: line });
    for (const line of b) out.push({ type: "add", text: line });
    return out;
  }

  const n = a.length;
  const m = b.length;

  // LCS DP table. dp[i][j] = LCS length of a[i..] and b[j..].
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  // Walk the table back to emit the diff in order.
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ type: "context", text: a[i] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      out.push({ type: "remove", text: a[i] });
      i++;
    } else {
      out.push({ type: "add", text: b[j] });
      j++;
    }
  }
  while (i < n) {
    out.push({ type: "remove", text: a[i] });
    i++;
  }
  while (j < m) {
    out.push({ type: "add", text: b[j] });
    j++;
  }
  return out;
}

/**
 * Format a unified diff string (for the "Copy diff" affordance). Context lines
 * get a leading space, added lines `+`, removed lines `-`, per the unified
 * diff convention.
 */
export function formatUnified(before: string, after: string, filePath: string): string {
  const lines = diffLines(before, after);
  const header = `--- a/${filePath}\n+++ b/${filePath}\n`;
  const body = lines.map((l) => {
    const prefix = l.type === "add" ? "+" : l.type === "remove" ? "-" : " ";
    return `${prefix}${l.text}`;
  });
  return header + body.join("\n");
}

/**
 * Detect whether a tool call's raw input describes a file edit, and if so
 * extract the file path plus the before/after text to diff.
 *
 * Recognized shapes:
 *   - `{ file_path|filePath|path|file, old_string, new_string }` — targeted
 *     replacement (before = old_string, after = new_string).
 *   - `{ file_path|filePath|path|file, content }` — full-file write (before is
 *     empty; the whole file is treated as added / a new file).
 *
 * Returns null when the input is not valid JSON or the shape is unrecognized,
 * so the caller can fall back to the existing raw rendering.
 */
export function parseFileEdit(input: string | undefined, _name: string): FileEdit | null {
  if (!input) return null;
  let data: unknown;
  try {
    data = JSON.parse(input);
  } catch {
    return null;
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const obj = data as Record<string, unknown>;

  const filePath =
    typeof obj.file_path === "string"
      ? obj.file_path
      : typeof obj.filePath === "string"
        ? obj.filePath
        : typeof obj.path === "string"
          ? obj.path
          : typeof obj.file === "string"
            ? obj.file
            : "";

  // Targeted replacement: old_string + new_string.
  if (typeof obj.old_string === "string" && typeof obj.new_string === "string") {
    return { filePath, before: obj.old_string, after: obj.new_string, isNewFile: false };
  }

  // Full-file write: content is the after state; before is empty (new file).
  if (typeof obj.content === "string") {
    return { filePath, before: "", after: obj.content, isNewFile: true };
  }

  return null;
}
