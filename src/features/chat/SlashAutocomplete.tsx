// SlashAutocomplete — the inline dropdown that surfaces matching slash commands
// when the user types '/' in the composer. Fuzzy-matches against the query text
// after the slash, ranks exact-prefix > startsWith > subsequence > alphabetical,
// and supports arrow-key navigation + Enter insertion (handled by ComposerInput).

import { useMemo } from "react";
import type { SlashCommand } from "../../ipc/contract";

/** Client-side slash commands handled entirely in the composer — no daemon
 * round-trip. `/cd` opens a native directory picker and calls `runCommand("cd")`
 * rather than sending a prompt. */
export const CLIENT_SIDE_COMMANDS: SlashCommand[] = [
  { name: "cd", description: "Change working directory", source: "builtin" },
];

/** Merge the client-side command set with the daemon-discovered commands.
 * Daemon/extension commands win on a name collision; client-only commands are
 * appended. Call this once and filter the result so autocomplete, Enter
 * insertion, and the composer's intercept all see the same list. */
export function mergeClientSideCommands(commands: SlashCommand[]): SlashCommand[] {
  const known = new Set(commands.map((c) => c.name));
  const clientOnly = CLIENT_SIDE_COMMANDS.filter((c) => !known.has(c.name));
  return [...commands, ...clientOnly];
}

type Props = {
  commands: SlashCommand[];
  query: string;
  onSelect: (command: SlashCommand) => void;
  onDismiss: () => void;
  selectedIndex: number;
  onSelectedIndexChange: (idx: number) => void;
};

/** True when `name` contains `query` as a case-insensitive subsequence. */
function isSubsequence(name: string, query: string): boolean {
  if (query.length === 0) return true;
  const n = name.toLowerCase();
  const q = query.toLowerCase();
  let qi = 0;
  for (let ni = 0; ni < n.length && qi < q.length; ni++) {
    if (n[ni] === q[qi]) qi++;
  }
  return qi === q.length;
}

/** Rank a command against the query: 0 = exact prefix, 1 = startsWith, 2 = subsequence. */
function matchRank(name: string, query: string): number {
  const n = name.toLowerCase();
  const q = query.toLowerCase();
  if (n === q) return 0;
  if (n.startsWith(q)) return 1;
  return 2;
}

/** Filter + rank commands against the query text after '/'. Shared by the
 * dropdown render and the composer's Enter-insertion lookup. */
export function filterSlashCommands(commands: SlashCommand[], query: string): SlashCommand[] {
  const q = query.trim();
  return commands
    .filter((c) => isSubsequence(c.name, q))
    .sort((a, b) => {
      const ra = matchRank(a.name, q);
      const rb = matchRank(b.name, q);
      if (ra !== rb) return ra - rb;
      return a.name.localeCompare(b.name);
    });
}

export function SlashAutocomplete({ commands, query, onSelect, onDismiss: _onDismiss, selectedIndex, onSelectedIndexChange }: Props) {
  const matches = useMemo(() => filterSlashCommands(commands, query), [commands, query]);

  if (matches.length === 0) return null;

  const visible = matches.slice(0, 8);

  return (
    <div className="slash-autocomplete" role="listbox" aria-label="Slash commands">
      {visible.map((cmd, i) => {
        const selected = i === selectedIndex;
        return (
          <button
            key={cmd.name}
            type="button"
            role="option"
            aria-selected={selected}
            className={`slash-autocomplete-item ${selected ? "slash-autocomplete-item--selected" : ""}`}
            onMouseEnter={() => onSelectedIndexChange(i)}
            onClick={() => onSelect(cmd)}
            onMouseDown={(e) => e.preventDefault()}
          >
            <span className="slash-autocomplete-name">
              /{cmd.name}
            </span>
            <span className="slash-autocomplete-desc">{cmd.description}</span>
          </button>
        );
      })}
      {matches.length > 8 ? (
        <div className="slash-autocomplete-more">
          {matches.length - 8} more…
        </div>
      ) : null}
    </div>
  );
}
