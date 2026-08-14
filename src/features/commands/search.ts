// search.ts — a small, dependency-free fuzzy matcher for the ⌘K palette.
// Subsequence match + case-insensitive + prefix / word-boundary / consecutive
// bonuses. Returns a score and the matched character indices (for highlight).
// No npm deps — self-contained.

export interface FuzzyMatch {
  /** Higher is better. */
  score: number;
  /** Indices (in the haystack) of the characters that matched the query. */
  indices: number[];
}

/**
 * Score `text` against `query`. Returns null when `query` is not a
 * case-insensitive subsequence of `text`. An empty query matches everything
 * with a neutral score.
 */
export function fuzzyScore(query: string, text: string): FuzzyMatch | null {
  const q = query.trim().toLowerCase();
  const t = text.toLowerCase();
  if (!q) return { score: 0, indices: [] };
  if (!t) return null;

  // Greedy subsequence scan, recording matched indices.
  const indices: number[] = [];
  let qi = 0;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) {
      indices.push(ti);
      qi++;
    }
  }
  if (qi < q.length) return null; // not a subsequence

  let score = 0;
  // Prefix bonus — the query is a prefix of the text.
  if (t.startsWith(q)) score += 100;
  // Consecutive-run bonus.
  let consecutive = 0;
  for (let i = 1; i < indices.length; i++) {
    if (indices[i] === indices[i - 1] + 1) consecutive++;
  }
  score += consecutive * 10;
  // Word-boundary bonus (start of string or after a separator).
  for (const idx of indices) {
    if (idx === 0 || /[\s\-_/.:]/.test(t[idx - 1])) score += 5;
  }
  // Penalize gaps (non-consecutive) and late starts.
  score -= (indices.length - q.length) * 2;
  score -= indices[0] * 0.5;
  return { score, indices };
}

/** Rank a list of candidates by fuzzy score, best first. */
export function fuzzyRank<T>(
  query: string,
  items: T[],
  textOf: (item: T) => string,
): Array<{ item: T; match: FuzzyMatch }> {
  const q = query.trim();
  if (!q) return [];
  const out: Array<{ item: T; match: FuzzyMatch }> = [];
  for (const item of items) {
    const match = fuzzyScore(q, textOf(item));
    if (match) out.push({ item, match });
  }
  return out.sort((a, b) => b.match.score - a.match.score);
}
