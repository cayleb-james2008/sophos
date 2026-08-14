// ModelSelector — a polished, custom dropdown for choosing the active model.
// Groups models by provider, shows the current selection with a checkmark,
// and calls setModel() on change. Includes a thinking-level dropdown for
// providers/models that support thinking. Built from the design tokens; no native
// <select> so we control the look, motion, and keyboard behavior.

import { useEffect, useRef, useState } from "react";
import { Text, Spinner, Select, Button } from "../../design";
import { useConnectionState } from "../../ipc/client";
import { useModels, DEFAULT_PROVIDER, DEFAULT_MODEL, type ModelSelection, type ThinkingLevel } from "./useModels";
import { ProviderGlyph } from "./providerGlyphs";
import "./providers.css";

function currentSelection(stateModel: { provider: string; model: string; thinking?: string } | undefined): ModelSelection {
  if (stateModel && stateModel.provider && stateModel.model) {
    return { provider: stateModel.provider, model: stateModel.model, thinking: stateModel.thinking as ThinkingLevel | undefined };
  }
  return { provider: DEFAULT_PROVIDER, model: DEFAULT_MODEL };
}

export function ModelSelector() {
  const state = useConnectionState();
  const { providers, models, loading, error, setModel, thinking, setThinking, thinkingLevels, fastMode, setFastMode } = useModels();
  const [open, setOpen] = useState(false);
  const [applying, setApplying] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const current = currentSelection(state.model);
  const currentModel = models.find((m) => m.id === current.model && m.provider === current.provider);
  const supportsThinking = currentModel?.supportsThinking ?? false;
  const supportsFast = currentModel?.supportsFast ?? false;

  // Close on outside click / Escape.
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

  const handleSelect = async (provider: string, model: string) => {
    if (provider === current.provider && model === current.model) {
      setOpen(false);
      return;
    }
    setApplying(true);
    await setModel(provider, model, supportsThinking ? thinking : undefined);
    setApplying(false);
    setOpen(false);
  };

  const handleThinkingChange = async (level: ThinkingLevel) => {
    setThinking(level);
    if (current.provider && current.model && supportsThinking) {
      await setModel(current.provider, current.model, level);
    }
  };

  const handleFastToggle = async () => {
    const next = !fastMode;
    await setFastMode(next);
    if (current.provider && current.model) {
      await setModel(current.provider, current.model, supportsThinking ? thinking : undefined, undefined, next);
    }
  };

  const grouped = providers
    .map((p) => ({
      provider: p,
      models: models.filter((m) => m.provider === p.id),
    }))
    .filter((g) => g.models.length > 0);

  return (
    <div ref={rootRef} className="ms-root">
      <div className="ms-inline-row">
        {/* Trigger */}
        <Button
          variant="outline"
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-haspopup="listbox"
          aria-expanded={open}
          className={`ms-trigger${open ? " ms-trigger--open" : ""}`}
        >
          <span className="ms-icon">
            <ProviderGlyph provider={current.provider} size={13} />
          </span>
          <span className="ms-triggermain">
            <Text variant="micro" tone="dim" mono className="ms-provider">
              {current.provider}
            </Text>
            <Text variant="label" weight="medium" mono className="ms-model">
              {currentModel?.name ?? current.model}
            </Text>
          </span>
            {applying ? (
            <Spinner size={12} />
          ) : (
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="rgba(var(--pa-paper-rgb), 0.45)"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ transform: open ? "rotate(180deg)" : undefined, transition: "transform 100ms cubic-bezier(0.3, 0, 0.2, 1)" }}
            >
              <polyline points="6 9 12 15 18 9" />
            </svg>
          )}
        </Button>

        {/* Inline thinking-level selector — visible at rest when the model supports thinking */}
        {supportsThinking && (
          <div className="ms-inline-thinking" data-testid="ms-inline-thinking">
            <Select
              options={thinkingLevels.map((l) => ({ value: l.value, label: l.label }))}
              value={thinking}
              onChange={(e) => handleThinkingChange(e.target.value as ThinkingLevel)}
              className="ms-inline-select"
              aria-label="Thinking level"
            />
          </div>
        )}

        {/* Inline fast-mode toggle — visible at rest when the model supports fast mode */}
        {supportsFast && (
          <button
            type="button"
            onClick={handleFastToggle}
            className={`ms-fast-toggle${fastMode ? " ms-fast-toggle--on" : ""}`}
            aria-pressed={fastMode}
            aria-label="Fast mode"
            data-testid="ms-fast-toggle"
          >
            <span className="ms-fast-dot" />
            <Text variant="micro" tone={fastMode ? "default" : "dim"} mono uppercase>
              Fast
            </Text>
          </button>
        )}
      </div>

      {/* Panel */}
      {open ? (
        <div
          role="listbox"
          aria-label="Model selector"
          className="ms-panel"
        >
          <div className="ms-panelhead">
            <Text variant="micro" tone="dim" mono uppercase>
              Model
            </Text>
          </div>

          {loading ? (
            <div className="ms-state">
              <Spinner size={14} />
              <Text variant="label" tone="muted">
                Loading catalog...
              </Text>
            </div>
          ) : error ? (
            <div className="ms-pad">
              <Text variant="label" tone="danger">
                {error}
              </Text>
            </div>
          ) : grouped.length === 0 ? (
            <div className="ms-pad">
              <Text variant="label" tone="muted">
                No models available.
              </Text>
            </div>
          ) : (
            grouped.map((group) => (
              <div key={group.provider.id} className="ms-group">
                <div className="ms-grouphead">
                  <span
                    className={`ms-groupicon${group.provider.connected ? " ms-groupicon--connected" : ""}`}
                  >
                    <ProviderGlyph provider={group.provider.id} size={11} />
                  </span>
                  <Text variant="micro" tone="dim" mono uppercase>
                    {group.provider.name}
                  </Text>
                </div>
                {group.models.map((m) => {
                  const isCurrent = m.id === current.model && m.provider === current.provider;
                  return (
                    <Button
                      key={`${m.provider}:${m.id}`}
                      variant={isCurrent ? "accent-soft" : "ghost"}
                      type="button"
                      role="option"
                      aria-selected={isCurrent}
                      onClick={() => handleSelect(m.provider, m.id)}
                      className={`ms-option${isCurrent ? " ms-option--current" : ""}`}
                    >
                      <span className="ms-optionmain">
                        <Text variant="label" weight={isCurrent ? "semibold" : "medium"} tone={isCurrent ? "default" : "muted"}>
                          {m.name ?? m.id}
                        </Text>
                        {m.contextWindow ? (
                          <Text variant="micro" tone="dim" mono>
                            {m.contextWindow.toLocaleString()} ctx
                            {m.supportsThinking ? " · thinking" : ""}
                          </Text>
                        ) : null}
                      </span>
                      {isCurrent ? (
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--pa-green-hover)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      ) : null}
                    </Button>
                  );
                })}
              </div>
            ))
          )}

        </div>
      ) : null}
    </div>
  );
}
