// ProfileSelector — the header control that picks the active agent profile and
// its runtime mode (v0.7). Selecting a profile visibly changes how the agent
// works: the header chip, the composer hint, and (in demo mode) the simulated
// responses all follow the active profile. The dropdown shows each profile's
// working style and its composed model/tools/skills/safety.

import { useEffect, useRef, useState } from "react";
import { Text, Button, Spinner } from "../../design";
import { useProfile, PROFILES, MODES, compositionSummary, type ProfileMode } from "./profiles";
import { studioCompositionSummary } from "../studio/editor";
import "./profiles.css";

export function ProfileSelector() {
  const {
    selection,
    profile,
    composition,
    loaded,
    setProfile,
    setMode,
    customProfiles,
    openStudioCreate,
    openStudioEdit,
    deleteCustomProfile,
  } = useProfile();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const handleSelect = (id: string) => {
    void setProfile(id);
    setOpen(false);
  };

  const handleMode = (mode: ProfileMode) => {
    void setMode(mode);
  };

  return (
    <div ref={rootRef} className="pr-root">
      <Button
        variant="outline"
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="dialog"
        aria-expanded={open}
        title={`Agent profile: ${profile.name}`}
        className={`pr-trigger${open ? " pr-trigger--open" : ""}`}
      >
        {!loaded ? <Spinner size={12} /> : null}
        <span className="pr-glyph" aria-hidden="true">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="8" r="4" />
            <path d="M4 21c0-4 3.6-6.5 8-6.5s8 2.5 8 6.5" />
          </svg>
        </span>
        <span className="pr-triggermain">
          <Text variant="micro" tone="dim" mono className="pr-label">Profile</Text>
          <Text variant="label" weight="medium" className="pr-name">{profile.name}</Text>
        </span>
        <span className="pr-mode-chip">{composition.mode}</span>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={`pr-chevron${open ? " pr-chevron--open" : ""}`}>
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </Button>

      {open ? (
        <div className="pr-panel" role="dialog" aria-label="Agent profile">
          <div className="pr-panelhead">
            <Text variant="micro" tone="dim" mono uppercase>Agent profile</Text>
          </div>

          <div className="pr-list">
            {PROFILES.map((p) => {
              const isCurrent = p.id === selection.id;
              return (
                <button
                  key={p.id}
                  type="button"
                  role="option"
                  aria-selected={isCurrent}
                  onClick={() => handleSelect(p.id)}
                  className={`pr-card${isCurrent ? " pr-card--current" : ""}`}
                >
                  <div className="pr-card-head">
                    <span className="pr-card-name">{p.name}</span>
                    {isCurrent ? (
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--pa-green-hover)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    ) : null}
                  </div>
                  <span className="pr-card-tagline">{p.tagline}</span>
                  <span className="pr-card-desc">{p.description}</span>
                  <span className="pr-card-chips">
                    {p.workingStyle.map((chip) => (
                      <span key={chip} className="pr-chip">{chip}</span>
                    ))}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Custom profiles — built in the Profile Studio (v0.7.1) */}
          <div className="pr-custom">
            <div className="pr-custom-head">
              <Text variant="micro" tone="dim" mono uppercase>Custom</Text>
              <Button variant="ghost" size="sm" type="button" onClick={() => { setOpen(false); openStudioCreate(); }} title="Build a new custom profile in the Profile Studio">
                + New profile
              </Button>
            </div>
            {customProfiles.length === 0 ? (
              <Text variant="micro" tone="muted" className="pr-custom-empty">
                No custom profiles yet — open the studio to compose one from the live tool registry.
              </Text>
            ) : (
              <div className="pr-custom-list">
                {customProfiles.map((p) => {
                  const isCurrent = p.id === selection.id;
                  return (
                    <div
                      key={p.id}
                      role="option"
                      aria-selected={isCurrent}
                      className={`pr-card pr-card--custom${isCurrent ? " pr-card--current" : ""}`}
                    >
                      <button type="button" className="pr-custom-main" onClick={() => handleSelect(p.id)} aria-label={`Select ${p.name}`}>
                        <div className="pr-card-head">
                          <span className="pr-card-name">{p.name}</span>
                          {isCurrent ? (
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--pa-green-hover)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                              <polyline points="20 6 9 17 4 12" />
                            </svg>
                          ) : null}
                        </div>
                        <span className="pr-card-tagline">{p.tagline || "Custom composition"}</span>
                        <span className="pr-card-chips">
                          {p.workingStyle.slice(0, 3).map((chip) => (
                            <span key={chip} className="pr-chip">{chip}</span>
                          ))}
                        </span>
                        <span className="pr-card-compose">{studioCompositionSummary(p)}</span>
                      </button>
                      <div className="pr-custom-actions">
                        <button type="button" className="pr-custom-action" onClick={() => { setOpen(false); openStudioEdit(p.id); }} aria-label={`Edit ${p.name}`}>Edit</button>
                        <button type="button" className="pr-custom-action pr-custom-action--danger" onClick={() => void deleteCustomProfile(p.id)} aria-label={`Delete ${p.name}`}>Delete</button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="pr-compose">
            <div className="pr-compose-head">
              <Text variant="micro" tone="dim" mono uppercase>Runtime mode</Text>
              <Text variant="micro" tone="dim">composes model · tools · skills · safety</Text>
            </div>
            <Button variant="ghost" size="sm" type="button" className="pr-studio-entry" onClick={() => { setOpen(false); openStudioCreate(); }} title="Open the Profile Studio — build your own agent profile from the live runtime">
              <span className="pr-studio-glyph" aria-hidden="true">✦</span>
              Profile Studio — build your own
            </Button>
            <div className="pr-modes">
              {MODES.map((mode) => (
                <Button
                  key={mode.id}
                  variant={selection.mode === mode.id ? "accent-soft" : "ghost"}
                  size="sm"
                  onClick={() => handleMode(mode.id)}
                  aria-pressed={selection.mode === mode.id}
                  className={`pr-mode${selection.mode === mode.id ? " pr-mode--active" : ""}`}
                >
                  {mode.label}
                </Button>
              ))}
            </div>
            <div className="pr-compose-summary">
              <Text variant="micro" tone="muted">{compositionSummary(composition)}</Text>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
