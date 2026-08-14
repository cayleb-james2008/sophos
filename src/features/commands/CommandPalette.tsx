// CommandPalette — the ⌘K command center overlay. Global shortcut (⌘K /
// Ctrl+K), fuzzy filtering across grouped commands, full keyboard navigation,
// a recent-queries breadcrumb (↑/↓ cycle history when the prompt is empty),
// inline per-row hints, and a type-glow on the prompt glyph.
//
// P4 adds two search sub-modes, modeled on the existing `naming` sub-mode:
//   * "Find session…"  — fuzzy search over session titles; selecting a result
//     opens the Sessions view filtered to the match.
//   * "Search transcript…" — searches the current session's message content;
//     selecting a result jumps to that message in the chat (scroll + highlight).

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Text, Kbd, Button } from "../../design";
import { useIpc } from "../../ipc/client";
import type { View } from "../../shell/nav";
import type { SessionInfo, TranscriptMessage, PromptTemplate } from "../../ipc/contract";
import { buildPaletteCommands, type PaletteCommand } from "./commands";
import { fuzzyRank } from "./search";
import { useTranscriptMessages, requestMessageFocus } from "../chat/chatBridge";
import { getComposerText, setComposerText } from "../chat/composerTextRef";
import { createPromptTemplate, addTemplate, removeTemplate, listTemplates } from "./promptTemplates";
import { relativeTime } from "../sessions/format";
import "./palette.css";

type FlatItem = { type: "header"; label: string; count: number } | { type: "cmd"; cmd: PaletteCommand };

type Submode = "none" | "naming" | "findSession" | "searchTranscript" | "saveTemplate" | "listTemplates" | "deleteTemplate";

const MAX_HISTORY = 5;

function SearchGlyph({ size = 15 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="7" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  );
}

function TemplateGlyph({ size = 15 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="8" y1="13" x2="16" y2="13" />
      <line x1="8" y1="17" x2="13" y2="17" />
    </svg>
  );
}

function TrashGlyph({ size = 15 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <line x1="10" y1="11" x2="10" y2="17" />
      <line x1="14" y1="11" x2="14" y2="17" />
    </svg>
  );
}

/** Build a snippet around a match, returning the match's position within it. */
function makeSnippet(text: string, start: number, len: number): { text: string; matchStart: number; matchLen: number } {
  const before = 40;
  const after = 60;
  const s = Math.max(0, start - before);
  const e = Math.min(text.length, start + len + after);
  const prefix = s > 0 ? "…" : "";
  const suffix = e < text.length ? "…" : "";
  const body = text.slice(s, e);
  return { text: prefix + body + suffix, matchStart: start - s + prefix.length, matchLen: len };
}

/** Render a snippet with the matched term highlighted (terminal green wash). */
function HighlightedSnippet({ snippet }: { snippet: { text: string; matchStart: number; matchLen: number } }) {
  const before = snippet.text.slice(0, snippet.matchStart);
  const match = snippet.text.slice(snippet.matchStart, snippet.matchStart + snippet.matchLen);
  const after = snippet.text.slice(snippet.matchStart + snippet.matchLen);
  return (
    <span>
      {before}
      <span className="palette__match">{match}</span>
      {after}
    </span>
  );
}

export function CommandPalette({
  onNavigate,
  onNewSession,
  onFindSession,
}: {
  onNavigate: (view: View) => void;
  onNewSession: () => void;
  /** Navigate to the Sessions view filtered to a query, selecting a session. */
  onFindSession: (filter: string, sessionId: string) => void;
}) {
  const ipc = useIpc();
  const messages = useTranscriptMessages();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const [history, setHistory] = useState<string[]>([]);
  const [historyIdx, setHistoryIdx] = useState(-1);
  const [submode, setSubmode] = useState<Submode>("none");
  const [nameValue, setNameValue] = useState("");
  const [nameErr, setNameErr] = useState("");
  const [nameBusy, setNameBusy] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchSel, setSearchSel] = useState(0);
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [sessionsError, setSessionsError] = useState<string | undefined>();
  const [templateName, setTemplateName] = useState("");
  const [templateNameErr, setTemplateNameErr] = useState("");
  const [templateNameBusy, setTemplateNameBusy] = useState(false);
  const [templates, setTemplates] = useState<PromptTemplate[]>([]);
  const [templatesError, setTemplatesError] = useState<string | undefined>();
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const searchListRef = useRef<HTMLDivElement>(null);

  const submitName = async () => {
    const n = nameValue.trim();
    if (!n || nameBusy) return;
    setNameBusy(true);
    setNameErr("");
    try {
      await ipc.setSessionName(n);
      pushHistory(`/name ${n}`);
      setSubmode("none");
      setOpen(false);
    } catch (err) {
      setNameErr(err instanceof Error ? err.message : String(err));
    } finally {
      setNameBusy(false);
    }
  };

  // ---- Prompt-template sub-mode handlers ----
  const loadTemplates = async () => {
    setTemplatesError(undefined);
    try {
      const settings = await ipc.getSettings();
      setTemplates(settings.promptTemplates ?? []);
    } catch (err) {
      setTemplatesError(err instanceof Error ? err.message : "Templates unavailable");
    }
  };

  const submitTemplate = async () => {
    const name = templateName.trim();
    const body = getComposerText();
    if (!name || templateNameBusy) return;
    if (!body.trim()) {
      setTemplateNameErr("The composer is empty — type a prompt to save first");
      return;
    }
    setTemplateNameBusy(true);
    setTemplateNameErr("");
    try {
      const settings = await ipc.getSettings();
      const next = addTemplate(settings.promptTemplates ?? [], createPromptTemplate(name, body));
      await ipc.setSettings({ ...settings, promptTemplates: next });
      pushHistory(`save template ${name}`);
      setSubmode("none");
      setOpen(false);
    } catch (err) {
      setTemplateNameErr(err instanceof Error ? err.message : String(err));
    } finally {
      setTemplateNameBusy(false);
    }
  };

  const selectTemplate = (i: number) => {
    const r = templateResults[i];
    if (!r) return;
    pushHistory(`insert template ${r.item.name}`);
    setComposerText(r.item.body);
    onNavigate("chat");
    setOpen(false);
  };

  const deleteTemplate = async (i: number) => {
    const r = templateResults[i];
    if (!r) return;
    try {
      const settings = await ipc.getSettings();
      const next = removeTemplate(settings.promptTemplates ?? [], r.item.id);
      await ipc.setSettings({ ...settings, promptTemplates: next });
      setTemplates(next);
      pushHistory(`delete template ${r.item.name}`);
    } catch (err) {
      setTemplatesError(err instanceof Error ? err.message : "Could not delete template");
    }
  };

  const groups = useMemo(
    () =>
      buildPaletteCommands(
        ipc,
        onNavigate,
        onNewSession,
        () => {
          setNameValue("");
          setNameErr("");
          setSubmode("naming");
        },
        () => {
          setSearchQuery("");
          setSearchSel(0);
          setSessionsError(undefined);
          setSubmode("findSession");
          void ipc
            .listSessions()
            .then(setSessions)
            .catch((e) => setSessionsError(e instanceof Error ? e.message : "Sessions unavailable"));
        },
        () => {
          setSearchQuery("");
          setSearchSel(0);
          setSubmode("searchTranscript");
        },
        () => {
          setTemplateName("");
          setTemplateNameErr("");
          setSubmode("saveTemplate");
        },
        () => {
          setSearchQuery("");
          setSearchSel(0);
          setTemplatesError(undefined);
          setSubmode("listTemplates");
          void loadTemplates();
        },
        () => {
          setSearchQuery("");
          setSearchSel(0);
          setTemplatesError(undefined);
          setSubmode("deleteTemplate");
          void loadTemplates();
        },
      ),
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

  // ---- Search sub-mode results ----
  const sessionResults = useMemo(
    () => fuzzyRank(searchQuery, sessions, (s) => s.title ?? s.id),
    [searchQuery, sessions],
  );

  const transcriptResults = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return [];
    const out: Array<{ message: TranscriptMessage; snippet: ReturnType<typeof makeSnippet> }> = [];
    for (const m of messages) {
      const content = m.content ?? "";
      const idx = content.toLowerCase().indexOf(q);
      if (idx >= 0) out.push({ message: m, snippet: makeSnippet(content, idx, q.length) });
    }
    return out;
  }, [searchQuery, messages]);

  // Template list results — all templates (sorted by name) when the query is
  // empty, fuzzy-ranked otherwise. Shared by the insert and delete sub-modes.
  const templateResults = useMemo(() => {
    const q = searchQuery.trim();
    if (!q) {
      return listTemplates(templates).map((t) => ({ item: t, match: { score: 0, indices: [] as number[] } }));
    }
    return fuzzyRank(searchQuery, templates, (t) => t.name);
  }, [searchQuery, templates]);

  const selectSession = (i: number) => {
    const r = sessionResults[i];
    if (!r) return;
    pushHistory(`find ${searchQuery.trim()}`);
    onFindSession(searchQuery.trim(), r.item.id);
    setOpen(false);
  };

  const selectTranscript = (i: number) => {
    const r = transcriptResults[i];
    if (!r) return;
    pushHistory(`search ${searchQuery.trim()}`);
    requestMessageFocus(r.message.id);
    onNavigate("chat");
    setOpen(false);
  };

  // Keyboard handling for the search sub-mode inputs. stopPropagation keeps the
  // panel-level handler (which drives the flat command list) from also firing.
  const onSearchKeyDown = (e: React.KeyboardEvent, resultCount: number, onSelect: (i: number) => void) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      e.stopPropagation();
      setSearchSel((s) => Math.min(s + 1, resultCount - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      e.stopPropagation();
      setSearchSel((s) => Math.max(s - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      e.stopPropagation();
      onSelect(searchSel);
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      setSubmode("none");
    }
  };

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
      setSubmode("none");
      setNameValue("");
      setNameErr("");
      setSearchQuery("");
      setSearchSel(0);
      setTemplateName("");
      setTemplateNameErr("");
      setTemplates([]);
      setTemplatesError(undefined);
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

  // Scroll the active search result into view.
  useEffect(() => {
    if (!open) return;
    const el = searchListRef.current?.querySelector<HTMLElement>(`[data-search-idx="${searchSel}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [searchSel, open, submode, searchQuery]);

  const pushHistory = (q: string) => {
    const t = q.trim();
    if (!t) return;
    setHistory((old) => [t, ...old.filter((x) => x !== t)].slice(0, MAX_HISTORY));
  };

  const runCommandAt = (flatIdx: number) => {
    const item = flat[flatIdx];
    if (item.type === "cmd") {
      pushHistory(query);
      item.cmd.run();
      // Sub-mode commands (naming / find-session / search-transcript) keep the
      // palette open so their input + results can be used; everything else closes.
      if (!item.cmd.keepOpen) setOpen(false);
    }
  };

  const runSelected = () => {
    const flatIdx = cmdIndexes[selected];
    if (flatIdx === undefined) return;
    runCommandAt(flatIdx);
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

        {/* List / sub-mode UI */}
        <div ref={listRef} className="palette__list">
          {submode === "naming" ? (
            <div className="palette__form">
              <label className="palette__formlabel">
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
                    setSubmode("none");
                  }
                }}
                placeholder="e.g. My task"
                aria-label="Session name"
                className="palette__field pa-focus-ring"
              />
              {nameErr ? (
                <span className="palette__error">{nameErr}</span>
              ) : null}
              <div className="palette__actions">
                <Button
                  variant="accent-soft"
                  type="button"
                  onClick={() => void submitName()}
                  disabled={nameBusy || !nameValue.trim()}
                  className={`palette__savebtn ${nameValue.trim() && !nameBusy ? "palette__savebtn--on" : "palette__savebtn--off"}`}
                >
                  {nameBusy ? "Saving…" : "Save"}
                </Button>
                <Button
                  variant="ghost"
                  type="button"
                  onClick={() => setSubmode("none")}
                  className="palette__cancelbtn"
                >
                  Cancel
                </Button>
              </div>
            </div>
          ) : submode === "findSession" ? (
            <div className="palette__search">
              <label className="palette__searchlabel">Find session</label>
              <input
                autoFocus
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setSearchSel(0);
                }}
                onKeyDown={(e) => onSearchKeyDown(e, sessionResults.length, selectSession)}
                placeholder="Search session titles…"
                aria-label="Search sessions"
                className="palette__field pa-focus-ring"
              />
              {sessionsError ? (
                <div className="palette__empty">Sessions unavailable — {sessionsError}</div>
              ) : sessionResults.length === 0 ? (
                <div className="palette__empty">
                  {searchQuery.trim() ? "No sessions match" : "Type to search session titles"}
                </div>
              ) : (
                <div ref={searchListRef} className="palette__searchlist">
                  {sessionResults.map((r, i) => {
                    const active = searchSel === i;
                    return (
                      <Button
                        key={r.item.id}
                        variant={active ? "accent-soft" : "ghost"}
                        data-search-idx={i}
                        onMouseEnter={() => setSearchSel(i)}
                        onClick={() => selectSession(i)}
                        className={`palette__row ${active ? "palette__row--active" : ""}`}
                      >
                        <span className="palette__rowicon">
                          <SearchGlyph />
                        </span>
                        <span className="palette__rowmeta">
                          <span className="palette__rowlabel">{r.item.title ?? r.item.id}</span>
                          <span className="palette__rowdesc">
                            {(r.item.status ?? "idle")} · {relativeTime(r.item.updatedAt)}
                          </span>
                        </span>
                        <span className="palette__rowhint">↵ open</span>
                      </Button>
                    );
                  })}
                </div>
              )}
            </div>
          ) : submode === "searchTranscript" ? (
            <div className="palette__search">
              <label className="palette__searchlabel">Search transcript</label>
              <input
                autoFocus
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setSearchSel(0);
                }}
                onKeyDown={(e) => onSearchKeyDown(e, transcriptResults.length, selectTranscript)}
                placeholder="Search the current session's messages…"
                aria-label="Search transcript"
                className="palette__field pa-focus-ring"
              />
              {messages.length === 0 ? (
                <div className="palette__empty">No messages in the current session to search</div>
              ) : transcriptResults.length === 0 ? (
                <div className="palette__empty">
                  {searchQuery.trim() ? "No matches in the transcript" : "Type to search the transcript"}
                </div>
              ) : (
                <div ref={searchListRef} className="palette__searchlist">
                  {transcriptResults.map((r, i) => {
                    const active = searchSel === i;
                    return (
                      <Button
                        key={r.message.id}
                        variant={active ? "accent-soft" : "ghost"}
                        data-search-idx={i}
                        onMouseEnter={() => setSearchSel(i)}
                        onClick={() => selectTranscript(i)}
                        className={`palette__row ${active ? "palette__row--active" : ""}`}
                      >
                        <span className="palette__rowicon">
                          <SearchGlyph />
                        </span>
                        <span className="palette__rowmeta">
                          <span className="palette__rowlabel">
                            <HighlightedSnippet snippet={r.snippet} />
                          </span>
                          <span className="palette__rowdesc">
                            {r.message.role} · {relativeTime(r.message.timestamp)}
                          </span>
                        </span>
                        <span className="palette__rowhint">↵ jump</span>
                      </Button>
                    );
                  })}
                </div>
              )}
            </div>
          ) : submode === "saveTemplate" ? (
            <div className="palette__form">
              <label className="palette__formlabel">Save current prompt as template</label>
              <input
                autoFocus
                value={templateName}
                onChange={(e) => setTemplateName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void submitTemplate();
                  } else if (e.key === "Escape") {
                    e.preventDefault();
                    e.stopPropagation();
                    setSubmode("none");
                  }
                }}
                placeholder="e.g. Code review"
                aria-label="Template name"
                className="palette__field pa-focus-ring"
              />
              {templateNameErr ? (
                <span className="palette__error">{templateNameErr}</span>
              ) : null}
              <div className="palette__actions">
                <Button
                  variant="accent-soft"
                  type="button"
                  onClick={() => void submitTemplate()}
                  disabled={templateNameBusy || !templateName.trim()}
                  className={`palette__savebtn ${templateName.trim() && !templateNameBusy ? "palette__savebtn--on" : "palette__savebtn--off"}`}
                >
                  {templateNameBusy ? "Saving…" : "Save"}
                </Button>
                <Button
                  variant="ghost"
                  type="button"
                  onClick={() => setSubmode("none")}
                  className="palette__cancelbtn"
                >
                  Cancel
                </Button>
              </div>
            </div>
          ) : submode === "listTemplates" ? (
            <div className="palette__search">
              <label className="palette__searchlabel">Insert template</label>
              <input
                autoFocus
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setSearchSel(0);
                }}
                onKeyDown={(e) => onSearchKeyDown(e, templateResults.length, selectTemplate)}
                placeholder="Search templates…"
                aria-label="Search templates"
                className="palette__field pa-focus-ring"
              />
              {templatesError ? (
                <div className="palette__empty">Templates unavailable — {templatesError}</div>
              ) : templateResults.length === 0 ? (
                <div className="palette__empty">
                  {templates.length === 0 ? "No saved templates yet — save one first" : "No templates match"}
                </div>
              ) : (
                <div ref={searchListRef} className="palette__searchlist">
                  {templateResults.map((r, i) => {
                    const active = searchSel === i;
                    return (
                      <Button
                        key={r.item.id}
                        variant={active ? "accent-soft" : "ghost"}
                        data-search-idx={i}
                        onMouseEnter={() => setSearchSel(i)}
                        onClick={() => selectTemplate(i)}
                        className={`palette__row ${active ? "palette__row--active" : ""}`}
                      >
                        <span className="palette__rowicon">
                          <TemplateGlyph />
                        </span>
                        <span className="palette__rowmeta">
                          <span className="palette__rowlabel">{r.item.name}</span>
                          <span className="palette__rowdesc">
                            {r.item.body.length > 60 ? `${r.item.body.slice(0, 60)}…` : r.item.body}
                          </span>
                        </span>
                        <span className="palette__rowhint">↵ insert</span>
                      </Button>
                    );
                  })}
                </div>
              )}
            </div>
          ) : submode === "deleteTemplate" ? (
            <div className="palette__search">
              <label className="palette__searchlabel">Delete template</label>
              <input
                autoFocus
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setSearchSel(0);
                }}
                onKeyDown={(e) => onSearchKeyDown(e, templateResults.length, (i) => void deleteTemplate(i))}
                placeholder="Search templates to delete…"
                aria-label="Search templates to delete"
                className="palette__field pa-focus-ring"
              />
              {templatesError ? (
                <div className="palette__empty">Templates unavailable — {templatesError}</div>
              ) : templateResults.length === 0 ? (
                <div className="palette__empty">
                  {templates.length === 0 ? "No saved templates yet" : "No templates match"}
                </div>
              ) : (
                <div ref={searchListRef} className="palette__searchlist">
                  {templateResults.map((r, i) => {
                    const active = searchSel === i;
                    return (
                      <Button
                        key={r.item.id}
                        variant={active ? "accent-soft" : "ghost"}
                        data-search-idx={i}
                        onMouseEnter={() => setSearchSel(i)}
                        onClick={() => void deleteTemplate(i)}
                        className={`palette__row ${active ? "palette__row--active" : ""}`}
                      >
                        <span className="palette__rowicon">
                          <TrashGlyph />
                        </span>
                        <span className="palette__rowmeta">
                          <span className="palette__rowlabel">{r.item.name}</span>
                          <span className="palette__rowdesc">
                            {r.item.body.length > 60 ? `${r.item.body.slice(0, 60)}…` : r.item.body}
                          </span>
                        </span>
                        <span className="palette__rowhint">↵ delete</span>
                      </Button>
                    );
                  })}
                </div>
              )}
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
                <Button
                  key={item.cmd.id}
                  variant={active ? "accent-soft" : "ghost"}
                  data-palette-idx={i}
                  onMouseEnter={() => setSelected(cmdIndexes.indexOf(i))}
                  onClick={() => {
                    // Run the CLICKED row directly (not whatever `selected`
                    // currently is) — a direct click without a prior hover must
                    // not run a stale selection. setSelected only updates the
                    // visual highlight; runCommandAt(i) runs the right command.
                    setSelected(cmdIndexes.indexOf(i));
                    runCommandAt(i);
                  }}
                  className={`palette__row ${active ? "palette__row--active" : ""}`}
                >
                  <span className="palette__rowicon">
                    {item.cmd.icon ?? <span className="palette__glyphicon">›</span>}
                  </span>
                  <span className="palette__rowmeta">
                    <span className="palette__rowlabel">{item.cmd.label}</span>
                    <span className="palette__rowdesc">{item.cmd.description}</span>
                  </span>
                  <span className="palette__rowhint">↵ run</span>
                </Button>
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
