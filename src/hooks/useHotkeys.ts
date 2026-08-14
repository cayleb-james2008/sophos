// useHotkeys — a global keyboard-shortcut registry hook.
//
// Registers a set of app-wide shortcuts on a `keydown` listener scoped to the
// window, and returns the definitions so callers can surface them in help (e.g.
// the command palette). Modifier matching is cross-platform: `cmd` and `ctrl`
// are treated as equivalent via `e.metaKey || e.ctrlKey`, so a shortcut defined
// as Cmd+N works on both macOS and Windows/Linux.

import { useEffect, useMemo, useRef } from "react";

export type HotkeyModifier = "cmd" | "ctrl" | "shift" | "alt";

export interface Hotkey {
  /** The key to match — `e.key`, lowercase for letters (e.g. "n", ",", "1"). */
  key: string;
  /** Optional required modifiers. `cmd`/`ctrl` both match meta-or-ctrl. */
  modifiers?: HotkeyModifier[];
  handler: () => void;
  /** Human-readable description shown in help / command palette. */
  description: string;
}

/** Normalize a KeyboardEvent key to a stable, case-insensitive form. */
function normalizeKey(key: string): string {
  return key.toLowerCase();
}

/** True when the required modifiers are all present AND no extra modifier is held. */
function modifiersMatch(e: KeyboardEvent, modifiers: HotkeyModifier[] | undefined): boolean {
  const mods = modifiers ?? [];
  // cmd/ctrl are cross-platform synonyms for the primary (meta-or-ctrl) modifier.
  const metaWanted = mods.includes("cmd") || mods.includes("ctrl");
  const shiftWanted = mods.includes("shift");
  const altWanted = mods.includes("alt");

  const metaPressed = e.metaKey || e.ctrlKey;
  return metaWanted === metaPressed && shiftWanted === e.shiftKey && altWanted === e.altKey;
}

/**
 * Register global keyboard shortcuts for the life of the component.
 *
 * @param shortcuts Map of key → behavior. Re-registration is cheap: the active
 *   definitions are read from a ref so the effect installs its listener once
 *   and never captures a stale closure.
 * @returns The same shortcuts array, so callers can render help.
 */
export function useHotkeys(shortcuts: Hotkey[]): Hotkey[] {
  const shortcutsRef = useRef<Hotkey[]>(shortcuts);
  shortcutsRef.current = shortcuts;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // Never hijack typing inside a text field.
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable)
      ) {
        return;
      }
      if (event.repeat) return;

      const pressedKey = normalizeKey(event.key);
      for (const shortcut of shortcutsRef.current) {
        if (pressedKey !== normalizeKey(shortcut.key)) continue;
        if (!modifiersMatch(event, shortcut.modifiers)) continue;
        event.preventDefault();
        shortcut.handler();
        break;
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // Memoized so the returned list has a stable identity across renders while
  // the caller's array changes; the ref above always sees the latest set.
  return useMemo(() => shortcuts, [shortcuts]);
}
