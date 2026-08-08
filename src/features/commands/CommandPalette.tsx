// CommandPalette — the ⌘K command center overlay. Global shortcut (⌘K /
// Ctrl+K), fuzzy filtering across grouped commands, full keyboard navigation,
// a recent-queries breadcrumb (↑/↓ cycle history when the prompt is empty),
// inline per-row hints, and a type-glow on the prompt glyph.

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { tokens } from "../../design/tokens";
import { Text, Kbd } from "../../design";
import { useIpc } from "../../ipc/client";
import type { View } from "../../shell/nav";
import { buildPaletteCommands, type PaletteCommand } from "./commands";
import "./palette.css";

type FlatItem = { type: "header"; label: string; count: number } | { type: "cmd"; cmd: PaletteCommand };

const MAX_HISTORY = 5;

export function CommandPalette({
  onNavigate,
  onNewSession,
}: {
  onNavigate: (view: View) => void;
  onNewSession: () => void;
}) {
  const ipc = useIpc();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const [history, setHistory] = useState<string[]>([]);
  const [historyIdx, setHistoryIdx] = useState(-1);
  const [naming, setNaming] = useState(false);
  const [nameValue, setNameValue] = useState("");
  const [nameErr, setNameErr] = useState("");
  const [nameBusy, setNameBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const submitName = async () => {
    const n = nameValue.trim();
    if (!n || nameBusy) return;
    setNameBusy(true);
    setNameErr("");
    try {
      await ipc.setSessionName(n);
      pushHistory(`/name ${n}`);
      setNaming(false);
      setOpen(false);
    } catch (err) {
      setNameErr(err instanceof Error ? err.message : String(err));
    } finally {
      setNameBusy(false);
    }
  };

  const groups = useMemo(
    () => buildPaletteCommands(ipc, onNavigate, onNewSession, () => {
      setNameValue("");
      setNameErr("");
      setNaming(true);
    }),
    [ipc, onNavigate, onNewSession],
  );

  // Flatten groups into headers + commands, filtered by query. When the prompt
  // is empty, prepend a "Recent" breadcrumb from history.
  const flat = useMemo<FlatItem[]>(() => {
    const q = query.trim().toLowerCase();
    const items: FlatItem[] = [];
    if (!q && history.length) {
      items.push({ type: "header", label: "Recent", count: history.length });
      for (const h of history) {
        items.push({
          type: "cmd",
          cmd: {
            id: `hist-${h}`,
            group: "Recent",
            label: h,
            description: "Re-run a previous query",
            keywords: h,
            run: () => {
              setQuery(h);
              window.setTimeout(() => inputRef.current?.focus(), 0);
            },
          },
        });
      }
    }
    for (const g of groups) {
      const matched = g.commands.filter((c) => {
        if (!q) return true;
        return `${c.label} ${c.description} ${c.keywords ?? ""}`.toLowerCase().includes(q);
      });
      if (matched.length) {
        items.push({ type: "header", label: g.label, count: matched.length });
        for (const c of matched) items.push({ type: "cmd", cmd: c });
      }
    }
    return items;
  }, [groups, query, history]);

  const cmdIndexes = useMemo(() => {
    const idx: number[] = [];
    flat.forEach((it, i) => {
      if (it.type === "cmd") idx.push(i);
    });
    return idx;
  }, [flat]);

  // Global ⌘K / Ctrl+K toggle.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Reset state each time the palette opens.
  useEffect(() => {
    if (open) {
      setQuery("");
      setSelected(0);
      setHistoryIdx(-1);
      setNaming(false);
      setNameValue("");
      setNameErr("");
      const t = window.setTimeout(() => inputRef.current?.focus(), 0);
      return () => window.clearTimeout(t);
    }
  }, [open]);

  // Keep selection in range when the result set shrinks.
  useEffect(() => {
    if (cmdIndexes.length === 0) return;
    if (selected >= cmdIndexes.length) setSelected(cmdIndexes.length - 1);
  }, [cmdIndexes.length, selected]);

  // Scroll the selected row into view.
  useEffect(() => {
    if (!open) return;
    const flatIdx = cmdIndexes[selected];
    if (flatIdx === undefined) return;
    const el = listRef.current?.querySelector<HTMLElement>(`[data-palette-idx="${flatIdx}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [selected, open, cmdIndexes]);

  const pushHistory = (q: string) => {
    const t = q.trim();
    if (!t) return;
    setHistory((old) => [t, ...old.filter((x) => x !== t)].slice(0, MAX_HISTORY));
  };

  const runSelected = () => {
    const flatIdx = cmdIndexes[selected];
    if (flatIdx === undefined) return;
    const item = flat[flatIdx];
    if (item.type === "cmd") {
      pushHistory(query);
      item.cmd.run();
      setOpen(false);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const inputFocused = document.activeElement === inputRef.current;
    const promptEmpty = query.trim() === "";

    // History cycling when the prompt is empty and focused (terminal pattern).
    if (inputFocused && promptEmpty && history.length) {
      if (e.key === "ArrowUp") {
        e.preventDefault();
        const next = historyIdx + 1;
        if (next < history.length) {
          setHistoryIdx(next);
          setQuery(history[next]);
        }
        return;
      }
      if (e.key === "ArrowDown" && historyIdx >= 0) {
        e.preventDefault();
        const next = historyIdx - 1;
        if (next >= 0) {
          setHistoryIdx(next);
          setQuery(history[next]);
        } else {
          setHistoryIdx(-1);
          setQuery("");
        }
        return;
      }
    }

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelected((s) => Math.min(s + 1, cmdIndexes.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelected((s) => Math.max(s - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      runSelected();
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  if (!open) return null;

  return createPortal(
    <div className="palette">
      <div className="palette__backdrop" onClick={() => setOpen(false)} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        onKeyDown={onKeyDown}
        className="palette__panel"
      >
        {/* Prompt */}
        <div className="palette__prompt">
          <span className={`palette__glyph ${query ? "palette__glyph--typing" : ""}`}>&gt;</span>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelected(0);
              setHistoryIdx(-1);
            }}
            placeholder="Type a command or search…"
            className="palette__input"
          />
          <Kbd>esc</Kbd>
        </div>

        {/* List / name prompt */}
        <div ref={listRef} className="palette__list">
          {naming ? (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 10,
                padding: "14px 16px",
              }}
            >
              <label
                style={{
                  fontFamily: tokens.font.mono,
                  fontSize: 12,
                  letterSpacing: "0.06em",
                  textTransform: "uppercase",
                  color: tokens.color.textMuted,
                }}
              >
                Set session name
              </label>
              <input
                autoFocus
                value={nameValue}
                onChange={(e) => setNameValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void submitName();
                  } else if (e.key === "Escape") {
                    e.preventDefault();
                    e.stopPropagation();
                    setNaming(false);
                  }
                }}
                placeholder="e.g. My task"
                aria-label="Session name"
                className="pa-focus-ring"
                style={{
                  width: "100%",
                  padding: "7px 10px",
                  borderRadius: tokens.radius.md,
                  background: tokens.color.bgElevated,
                  border: `1px solid ${tokens.color.borderStrong}`,
                  color: tokens.color.text,
                  fontFamily: tokens.font.sans,
                  fontSize: tokens.font.size.md,
                  outline: "none",
                }}
              />
              {nameErr ? (
                <span style={{ color: tokens.color.danger, fontSize: 12 }}>{nameErr}</span>
              ) : null}
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  type="button"
                  onClick={() => void submitName()}
                  disabled={nameBusy || !nameValue.trim()}
                  className="pa-focus-ring"
                  style={{
                    padding: "6px 14px",
                    borderRadius: tokens.radius.md,
                    background: nameValue.trim() && !nameBusy ? tokens.color.accent : tokens.color.bgOverlay,
                    border: `1px solid ${tokens.color.accent}`,
                    color: nameValue.trim() && !nameBusy ? "#fff" : tokens.color.textDim,
                    cursor: nameValue.trim() && !nameBusy ? "pointer" : "not-allowed",
                    fontFamily: tokens.font.sans,
                    fontSize: tokens.font.size.sm,
                  }}
                >
                  {nameBusy ? "Saving…" : "Save"}
                </button>
                <button
                  type="button"
                  onClick={() => setNaming(false)}
                  className="pa-focus-ring"
                  style={{
                    padding: "6px 14px",
                    borderRadius: tokens.radius.md,
                    background: "transparent",
                    border: `1px solid ${tokens.color.borderStrong}`,
                    color: tokens.color.textMuted,
                    cursor: "pointer",
                    fontFamily: tokens.font.sans,
                    fontSize: tokens.font.size.sm,
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : flat.length === 0 ? (
            <div className="palette__empty">No commands match “{query}”</div>
          ) : (
            flat.map((item, i) => {
              if (item.type === "header") {
                return (
                  <div key={`h-${item.label}`} className="palette__grouphead">
                    <span>{item.label}</span>
                    <span>{item.count}</span>
                  </div>
                );
              }
              const active = cmdIndexes[selected] === i;
              return (
                <button
                  key={item.cmd.id}
                  data-palette-idx={i}
                  onMouseEnter={() => setSelected(cmdIndexes.indexOf(i))}
                  onClick={runSelected}
                  className={`palette__row ${active ? "palette__row--active" : ""}`}
                >
                  <span className="palette__rowicon">
                    {item.cmd.icon ?? <span style={{ fontFamily: tokens.font.mono, fontSize: 13 }}>›</span>}
                  </span>
                  <span className="palette__rowmeta">
                    <span className="palette__rowlabel">{item.cmd.label}</span>
                    <span className="palette__rowdesc">{item.cmd.description}</span>
                  </span>
                  <span className="palette__rowhint">↵ run</span>
                </button>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div className="palette__foot">
          <span className="palette__hint">
            <Kbd>↑↓</Kbd>
            <Text variant="micro" tone="dim">
              navigate
            </Text>
          </span>
          <span className="palette__hint">
            <Kbd>↵</Kbd>
            <Text variant="micro" tone="dim">
              run
            </Text>
          </span>
          <span className="palette__hint">
            <Kbd>esc</Kbd>
            <Text variant="micro" tone="dim">
              close
            </Text>
          </span>
          <span className="palette__count">
            {cmdIndexes.length} command{cmdIndexes.length === 1 ? "" : "s"}
          </span>
        </div>
      </div>
    </div>,
    document.body,
  );
}
