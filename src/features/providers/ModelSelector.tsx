// ModelSelector — a polished, custom dropdown for choosing the active model.
// Groups models by provider, shows the current selection with a checkmark,
// and calls setModel() on change. Includes a thinking-level dropdown for
// providers/models that support thinking. Built from the design tokens; no native
// <select> so we control the look, motion, and keyboard behavior.

import { useEffect, useRef, useState } from "react";
import { tokens } from "../../design/tokens";
import { Text, Spinner, Select, Button } from "../../design";
import { useConnectionState } from "../../ipc/client";
import { useModels, DEFAULT_PROVIDER, DEFAULT_MODEL, type ModelSelection, type ThinkingLevel } from "./useModels";
import { ProviderGlyph } from "./providerGlyphs";

function currentSelection(stateModel: { provider: string; model: string; thinking?: string } | undefined): ModelSelection {
  if (stateModel && stateModel.provider && stateModel.model) {
    return { provider: stateModel.provider, model: stateModel.model, thinking: stateModel.thinking as ThinkingLevel | undefined };
  }
  return { provider: DEFAULT_PROVIDER, model: DEFAULT_MODEL };
}

export function ModelSelector() {
  const state = useConnectionState();
  const { providers, models, loading, error, setModel, thinking, setThinking, thinkingLevels } = useModels();
  const [open, setOpen] = useState(false);
  const [applying, setApplying] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const current = currentSelection(state.model);
  const currentModel = models.find((m) => m.id === current.model && m.provider === current.provider);
  const supportsThinking = currentModel?.supportsThinking ?? false;

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

  const grouped = providers
    .map((p) => ({
      provider: p,
      models: models.filter((m) => m.provider === p.id),
    }))
    .filter((g) => g.models.length > 0);

  return (
    <div ref={rootRef} style={{ position: "relative" }}>
      {/* Trigger */}
      <Button
        variant="outline"
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        style={{
          display: "flex",
          alignItems: "center",
          gap: tokens.space.sm,
          background: open ? tokens.color.bgOverlay : tokens.color.bgRaised,
          border: `1px solid ${open ? tokens.color.accentBorder : tokens.color.border}`,
          borderRadius: tokens.radius.md,
          padding: "5px 10px",
          cursor: "pointer",
          color: tokens.color.text,
          fontFamily: tokens.font.sans,
          transition: `all ${tokens.motion.fast} ${tokens.motion.ease}`,
          boxShadow: open ? tokens.shadow.glow : undefined,
        }}
      >
        <span
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 22,
            height: 22,
            borderRadius: tokens.radius.sm,
            background: tokens.color.accentSoft,
            color: tokens.color.accentHover,
            flexShrink: 0,
          }}
        >
          <ProviderGlyph provider={current.provider} size={13} />
        </span>
        <span style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", lineHeight: 1.15 }}>
          <Text variant="micro" tone="dim" mono style={{ fontSize: 9 }}>
            {current.provider}
          </Text>
          <Text variant="label" weight="medium" mono style={{ fontSize: 11.5 }}>
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
            stroke={tokens.color.textDim}
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{ transform: open ? "rotate(180deg)" : undefined, transition: `transform ${tokens.motion.fast} ${tokens.motion.ease}` }}
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
        )}
      </Button>

      {/* Panel */}
      {open ? (
        <div
          role="listbox"
          aria-label="Model selector"
          style={{
            position: "absolute",
            top: "calc(100% + 8px)",
            right: 0,
            width: 320,
            maxHeight: 420,
            overflowY: "auto",
            background: tokens.color.bgRaised,
            border: `1px solid ${tokens.color.borderStrong}`,
            borderRadius: tokens.radius.lg,
            boxShadow: tokens.shadow.lg,
            zIndex: 60,
            padding: tokens.space.xs,
            animation: "pa-scale-in 140ms cubic-bezier(0.16,1,0.3,1)",
          }}
        >
          <div style={{ padding: `${tokens.space.sm} ${tokens.space.md}`, borderBottom: `1px solid ${tokens.color.border}` }}>
            <Text variant="micro" tone="dim" mono uppercase>
              Model
            </Text>
          </div>

          {loading ? (
            <div style={{ display: "flex", alignItems: "center", gap: tokens.space.sm, padding: tokens.space.lg }}>
              <Spinner size={14} />
              <Text variant="label" tone="muted">
                Loading catalog...
              </Text>
            </div>
          ) : error ? (
            <div style={{ padding: tokens.space.lg }}>
              <Text variant="label" tone="danger">
                {error}
              </Text>
            </div>
          ) : grouped.length === 0 ? (
            <div style={{ padding: tokens.space.lg }}>
              <Text variant="label" tone="muted">
                No models available.
              </Text>
            </div>
          ) : (
            grouped.map((group) => (
              <div key={group.provider.id} style={{ marginBottom: tokens.space.xs }}>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: tokens.space.sm,
                    padding: `${tokens.space.sm} ${tokens.space.md} ${tokens.space.xs}`,
                  }}
                >
                  <span
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      width: 18,
                      height: 18,
                      borderRadius: tokens.radius.sm,
                      background: group.provider.connected ? tokens.color.accentSoft : tokens.color.bgOverlay,
                      color: group.provider.connected ? tokens.color.accentHover : tokens.color.textDim,
                      flexShrink: 0,
                    }}
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
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: tokens.space.sm,
                        width: "100%",
                        padding: "7px 12px",
                        borderRadius: tokens.radius.md,
                        background: isCurrent ? tokens.color.accentSoft : "transparent",
                        border: "none",
                        cursor: "pointer",
                        color: isCurrent ? tokens.color.text : tokens.color.textMuted,
                        fontFamily: tokens.font.sans,
                        fontSize: tokens.font.size.sm,
                        textAlign: "left",
                        transition: `background ${tokens.motion.fast} ${tokens.motion.ease}`,
                      }}
                      onMouseEnter={(e) => {
                        if (!isCurrent) e.currentTarget.style.background = tokens.color.bgOverlay;
                      }}
                      onMouseLeave={(e) => {
                        if (!isCurrent) e.currentTarget.style.background = "transparent";
                      }}
                    >
                      <span style={{ display: "flex", flexDirection: "column", gap: 1 }}>
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
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={tokens.color.accentHover} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      ) : null}
                    </Button>
                  );
                })}
              </div>
            ))
          )}

          {supportsThinking && (
            <div style={{ borderTop: `1px solid ${tokens.color.border}`, padding: tokens.space.sm, margin: `0 ${tokens.space.sm} ${tokens.space.sm}` }}>
              <div style={{ display: "flex", alignItems: "center", gap: tokens.space.sm, marginBottom: tokens.space.xs }}>
                <span
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    width: 18,
                    height: 18,
                    borderRadius: tokens.radius.sm,
                    background: tokens.color.accentSoft,
                    color: tokens.color.accentHover,
                    flexShrink: 0,
                  }}
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M9 18h6" />
                    <path d="M12 12v6" />
                    <circle cx="12" cy="12" r="10" />
                  </svg>
                </span>
                <Text variant="micro" tone="dim" mono uppercase>
                  Thinking level
                </Text>
              </div>
              <Select
                options={thinkingLevels.map((l) => ({ value: l.value, label: l.label }))}
                value={thinking}
                onChange={(e) => handleThinkingChange(e.target.value as ThinkingLevel)}
                style={{ width: "100%" }}
              />
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
