// ShortcutsOverlay — the discoverable keyboard-shortcuts modal.
//
// Triggered by pressing `?` or `Cmd+/` (Ctrl+/ on Windows) outside a text
// field. Renders a list of registered shortcuts grouped by view. Built on the
// design-system Modal so it picks up the same escape/click-outside semantics,
// then layers its own table-style body inside.
//
// Each row shows the description on the left and the pressed keys on the right
// as a series of monospace Kbd chips. Modifier + key combos render in the
// convention seen across the rest of the app: `⌘ K`, `Shift ?`.

import React, { useMemo } from "react";
import { Modal, Kbd } from "./index";
import type { Hotkey } from "../hooks/useHotkeys";
import "./shortcuts-overlay.css";

/** A group of shortcuts that share a context — the modal renders one section
 *  per group, then a fresh row per shortcut inside it. */
export interface ShortcutsGroup {
  /** Section heading shown above the rows (e.g. "Navigation", "Commands"). */
  title: string;
  /** Shortcuts inside the section. */
  shortcuts: Hotkey[];
}

export interface ShortcutsOverlayProps {
  open: boolean;
  onClose: () => void;
  /** Grouped list of shortcuts to display. The order in the array is the
   *  vertical order in the modal. */
  groups: ShortcutsGroup[];
}

const MODIFIER_LABELS: Record<string, string> = {
  cmd: "\u2318", // ⌘
  ctrl: "Ctrl",
  shift: "Shift",
  alt: "Alt",
};

/** Pretty-print a key. Letters keep their natural case; symbols / wide names
 *  are returned as-is so they read as the user typed them. */
function formatKey(key: string): string {
  if (key === "?") return "?";
  if (key === "/") return "/";
  if (key === ",") return ",";
  if (key === ".") return ".";
  if (key === "ArrowUp") return "\u2191"; // ↑
  if (key === "ArrowDown") return "\u2193"; // ↓
  if (key === "ArrowLeft") return "\u2190"; // ←
  if (key === "ArrowRight") return "\u2192"; // →
  return key.length === 1 ? key.toUpperCase() : key;
}

function KeyCombo({ keyName, modifiers }: { keyName: string; modifiers?: string[] }) {
  const mods = modifiers ?? [];
  // Render each token as its own Kbd chip so the platform's monospace stack
  // stays consistent. Platform convention is `Cmd K`, `Shift ?`, etc.
  const tokens = [
    ...mods
      // Render modifiers in canonical order so identical shortcuts always
      // display identically.
      .slice()
      .sort((a, b) => orderModifier(a) - orderModifier(b))
      .map((m) => MODIFIER_LABELS[m] ?? m),
    formatKey(keyName),
  ];
  return (
    <span className="shortcuts-overlay__keys">
      {tokens.map((t, i) => (
        <React.Fragment key={`${t}-${i}`}>
          {i > 0 ? <span className="shortcuts-overlay__plus">+</span> : null}
          <Kbd>{t}</Kbd>
        </React.Fragment>
      ))}
    </span>
  );
}

/** Stable, low-cardinal ordering for modifier chips so `Cmd Shift K` always
 *  renders the same way no matter the array order it arrived in. */
function orderModifier(m: string): number {
  switch (m) {
    case "cmd":
    case "ctrl":
      return 0;
    case "alt":
      return 1;
    case "shift":
      return 2;
    default:
      return 9;
  }
}

export function ShortcutsOverlay({ open, onClose, groups }: ShortcutsOverlayProps) {
  // Flatten + total for the footer summary.
  const total = useMemo(() => groups.reduce((sum, g) => sum + g.shortcuts.length, 0), [groups]);

  return (
    <Modal open={open} onClose={onClose} width={540}>
      <div className="shortcuts-overlay__head">
        <div className="shortcuts-overlay__title">
          <span className="shortcuts-overlay__eyebrow">Keyboard</span>
          <span className="shortcuts-overlay__heading">Shortcuts</span>
        </div>
        <button
          type="button"
          className="shortcuts-overlay__close"
          aria-label="Close shortcuts"
          onClick={onClose}
        >
          ✕
        </button>
      </div>

      <div className="shortcuts-overlay__body">
        {groups.map((group) => (
          <section key={group.title} className="shortcuts-overlay__group">
            <h3 className="shortcuts-overlay__grouphead">{group.title}</h3>
            <div className="shortcuts-overlay__rows">
              {group.shortcuts.map((s) => (
                <div key={`${s.key}-${s.modifiers?.join("-") ?? ""}-${s.description}`} className="shortcuts-overlay__row">
                  <div className="shortcuts-overlay__label">{s.description}</div>
                  <KeyCombo keyName={s.key} modifiers={s.modifiers} />
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>

      <div className="shortcuts-overlay__foot">
        <span className="shortcuts-overlay__hint">
          <Kbd>?</Kbd>
          <span>or</span>
          <Kbd>Ctrl + /</Kbd>
          <span>to toggle</span>
        </span>
        <span>
          {total} shortcut{total === 1 ? "" : "s"} · press <Kbd>Esc</Kbd> to close
        </span>
      </div>
    </Modal>
  );
}
