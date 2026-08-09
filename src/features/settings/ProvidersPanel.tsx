// ProvidersPanel — the provider catalog. Cards for each provider
// (ollama-cloud, openrouter, minimax, opencode/codex) with connection status,
// kind badge, model list, and login/logout. Wired to getProviders / getModels
// / login / logout.
//
// P10 (max context + max output): every model defaults to its provider MAX for
// both context window and max output tokens. Each model row has a "Configure"
// control that expands an in-app adjuster — slider + numeric input for each
// value, ceiling shown as the provider max — persisted to settings and pushed
// to the engine via useModels().setModelConfig (graceful offline).

import { useRef, useState } from "react";
import { tokens } from "../../design/tokens";
import { Text, Card, Badge, Button, Modal, Input, StatusDot, Spinner } from "../../design";
import { useIpc } from "../../ipc/client";
import type { ModelInfo, ProviderInfo } from "../../ipc/contract";
import { useModels, modelKey } from "../providers/useModels";
import { KeyIcon, LogoutIcon, PlugIcon, CpuIcon } from "../sessions/icons";

export function ProvidersPanel() {
  const ipc = useIpc();
  const { providers, models, loading, reload, setModelConfig, resetModelConfig } = useModels();
  const [loginTarget, setLoginTarget] = useState<ProviderInfo | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const providerModels = (p: ProviderInfo): ModelInfo[] =>
    p.models.length ? p.models : models.filter((m) => m.provider === p.id);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: tokens.space.lg }}>
      {loading ? (
        <div style={{ display: "flex", justifyContent: "center", padding: tokens.space["3xl"] }}>
          <Spinner size={22} />
        </div>
      ) : providers.length === 0 ? (
        <Card variant="raised" padding="lg">
          <Text variant="body" tone="dim">
            No providers configured yet.
          </Text>
        </Card>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: tokens.space.lg }}>
          {providers.map((p) => {
            const pModels = providerModels(p);
            return (
              <ProviderCard
                key={p.id}
                provider={p}
                models={pModels}
                expandedKey={expanded}
                onToggle={(key) => setExpanded((k) => (k === key ? null : key))}
                onApply={setModelConfig}
                onReset={resetModelConfig}
                onLogin={() => setLoginTarget(p)}
                onLogout={() => {
                  void ipc.logout(p.id).then(() => reload());
                }}
              />
            );
          })}
        </div>
      )}

      {loginTarget ? (
        <LoginModal
          provider={loginTarget}
          onClose={() => setLoginTarget(null)}
          onDone={() => {
            setLoginTarget(null);
            void reload();
          }}
        />
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Provider card
// ---------------------------------------------------------------------------

function ProviderCard({
  provider,
  models,
  expandedKey,
  onToggle,
  onApply,
  onReset,
  onLogin,
  onLogout,
}: {
  provider: ProviderInfo;
  models: ModelInfo[];
  expandedKey: string | null;
  onToggle: (key: string) => void;
  onApply: (provider: string, model: string, runtime: { contextWindow?: number; maxOutputTokens?: number }) => void;
  onReset: (provider: string, model: string) => void;
  onLogin: () => void;
  onLogout: () => void;
}) {
  const managed = provider.kind === "subscription";
  return (
    <Card variant="raised" padding="lg" style={{ display: "flex", flexDirection: "column", gap: tokens.space.lg }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: tokens.space.md }}>
        <div style={{ display: "flex", alignItems: "center", gap: tokens.space.md }}>
          <span
            style={{
              width: 36,
              height: 36,
              flexShrink: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              borderRadius: tokens.radius.md,
              background: provider.connected ? tokens.color.accentSoft : tokens.color.bgOverlay,
              border: `1px solid ${provider.connected ? tokens.color.accentBorder : tokens.color.border}`,
              color: provider.connected ? tokens.color.accentHover : tokens.color.textDim,
            }}
          >
            <PlugIcon size={17} />
          </span>
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <Text variant="label" weight="semibold">
              {provider.name}
            </Text>
            <Text variant="micro" tone="dim" mono>
              {provider.id}
            </Text>
          </div>
        </div>
        <Badge tone={provider.connected ? "success" : "neutral"} dot>
          {provider.connected ? "Connected" : "Offline"}
        </Badge>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: tokens.space.sm }}>
        <Badge tone={managed ? "accent" : "neutral"}>{managed ? "Managed" : "API key"}</Badge>
        <StatusDot state={provider.connected ? "connected" : "idle"} size={6} />
      </div>

      {/* Models — each row can expand into a runtime-config adjuster */}
      <div style={{ display: "flex", flexDirection: "column", gap: tokens.space.sm }}>
        <div style={{ display: "flex", alignItems: "center", gap: tokens.space.sm }}>
          <CpuIcon size={12} color={tokens.color.textDim} />
          <Text variant="micro" tone="dim" uppercase>
            Models
          </Text>
        </div>
        {models.length ? (
          <div style={{ display: "flex", flexDirection: "column", gap: tokens.space.xs }}>
            {models.map((m) => {
              const key = modelKey(m.provider, m.id);
              const open = expandedKey === key;
              return (
                <div
                  key={m.id}
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    border: `1px solid ${open ? tokens.color.accentBorder : tokens.color.border}`,
                    borderRadius: tokens.radius.md,
                    background: open ? tokens.color.bgOverlay : tokens.color.bgOverlay,
                    overflow: "hidden",
                    transition: `border-color ${tokens.motion.fast} ${tokens.motion.ease}`,
                  }}
                >
                  <button
                    type="button"
                    onClick={() => onToggle(key)}
                    className="pa-focus-ring"
                    aria-expanded={open}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: tokens.space.sm,
                      width: "100%",
                      padding: "7px 10px",
                      background: "transparent",
                      border: "none",
                      cursor: "pointer",
                      color: tokens.color.text,
                      fontFamily: tokens.font.mono,
                      fontSize: tokens.font.size.xs,
                      textAlign: "left",
                    }}
                  >
                    <span style={{ display: "flex", alignItems: "center", gap: tokens.space.xs, minWidth: 0 }}>
                      <span
                        style={{
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          color: open ? tokens.color.accentHover : tokens.color.textMuted,
                        }}
                      >
                        {m.name ?? m.id}
                      </span>
                      {m.supportsThinking && (
                        <span
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            justifyContent: "center",
                            width: 14,
                            height: 14,
                            borderRadius: tokens.radius.full,
                            background: tokens.color.accentSoft,
                            color: tokens.color.accentHover,
                            fontSize: 8,
                            flexShrink: 0,
                          }}
                          title="Supports thinking"
                        >
                          🧠
                        </span>
                      )}
                    </span>
                    <span style={{ display: "flex", alignItems: "center", gap: tokens.space.sm }}>
                      <span style={{ color: tokens.color.textDim, fontSize: tokens.font.size.xs }}>
                        {m.contextWindow ? `${m.contextWindow.toLocaleString()} ctx` : ""}
                        {m.contextWindow && m.maxOutputTokens ? ` · ${m.maxOutputTokens.toLocaleString()} out` : ""}
                      </span>
                      <Chevron open={open} />
                    </span>
                  </button>

                  {open ? (
                    <ModelConfigEditor
                      model={m}
                      onApply={(runtime) => onApply(m.provider, m.id, runtime)}
                      onReset={() => onReset(m.provider, m.id)}
                    />
                  ) : null}
                </div>
              );
            })}
          </div>
        ) : (
          <Text variant="micro" tone="dim">
            {managed ? "Managed — models auto-synced" : "No models listed"}
          </Text>
        )}
      </div>

      <div style={{ borderTop: `1px solid ${tokens.color.border}`, paddingTop: tokens.space.md }}>
        {provider.connected ? (
          <Button variant="outline" size="sm" icon={<LogoutIcon size={13} />} onClick={onLogout}>
            Log out
          </Button>
        ) : (
          <Button variant="accent-soft" size="sm" icon={<KeyIcon size={13} />} onClick={onLogin}>
            Connect
          </Button>
        )}
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// In-app runtime config adjuster — context window + max output tokens
// ---------------------------------------------------------------------------

const MIN_TOKENS = 1024;

function ModelConfigEditor({
  model,
  onApply,
  onReset,
}: {
  model: ModelInfo;
  onApply: (runtime: { contextWindow: number; maxOutputTokens: number }) => void;
  onReset: () => void;
}) {
  const ceilCtx = model.maxContextWindow ?? model.contextWindow ?? 128000;
  const ceilOut = model.maxOutputTokensCeiling ?? model.maxOutputTokens ?? 16384;
  const [ctx, setCtx] = useState(model.contextWindow ?? ceilCtx);
  const [out, setOut] = useState(model.maxOutputTokens ?? ceilOut);

  const apply = () => {
    onApply({ contextWindow: ctx, maxOutputTokens: out });
  };

  return (
    <div style={{ borderTop: `1px solid ${tokens.color.border}`, padding: tokens.space.md, display: "flex", flexDirection: "column", gap: tokens.space.md }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: tokens.space.sm }}>
        <Text variant="micro" tone="dim" mono uppercase>
          Runtime config
        </Text>
        <Button variant="ghost" size="sm" onClick={() => { setCtx(ceilCtx); setOut(ceilOut); onReset(); }}>
          Reset to max
        </Button>
      </div>

      <TokenField
        label="Context window"
        value={ctx}
        max={ceilCtx}
        min={MIN_TOKENS}
        onChange={setCtx}
      />
      <TokenField
        label="Max output tokens"
        value={out}
        max={ceilOut}
        min={MIN_TOKENS}
        onChange={setOut}
      />

      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <Button variant="accent-soft" size="sm" onClick={apply}>
          Apply to model
        </Button>
      </div>
    </div>
  );
}

function TokenField({
  label,
  value,
  max,
  min,
  onChange,
}: {
  label: string;
  value: number;
  max: number;
  min: number;
  onChange: (v: number) => void;
}) {
  const step = Math.max(1, Math.round(max / 200));
  const pct = ((value - min) / Math.max(1, max - min)) * 100;

  const commit = (raw: number) => {
    if (!Number.isFinite(raw)) return;
    onChange(Math.min(max, Math.max(min, Math.round(raw))));
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: tokens.space.xs }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: tokens.space.sm }}>
        <Text variant="micro" tone="muted" uppercase>
          {label}
        </Text>
        <Text variant="micro" tone="dim" mono>
          {value.toLocaleString()} / {max.toLocaleString()}
        </Text>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: tokens.space.sm }}>
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          aria-label={label}
          onChange={(e) => commit(Number(e.target.value))}
          style={{
            flex: 1,
            minWidth: 0,
            accentColor: tokens.color.accent,
            height: 4,
            cursor: "pointer",
          }}
        />
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: tokens.space.xs,
            width: 132,
            background: tokens.color.bgElevated,
            border: `1px solid ${tokens.color.border}`,
            borderRadius: tokens.radius.sm,
            padding: "0 8px",
          }}
        >
          <input
            type="number"
            min={min}
            max={max}
            value={value}
            aria-label={`${label} value`}
            onChange={(e) => commit(Number(e.target.value))}
            style={{
              flex: 1,
              minWidth: 0,
              background: "transparent",
              border: "none",
              outline: "none",
              color: tokens.color.text,
              fontFamily: tokens.font.mono,
              fontSize: tokens.font.size.xs,
              padding: "5px 0",
            }}
          />
          <span style={{ color: tokens.color.textDim, fontSize: 9, fontFamily: tokens.font.mono }}>tok</span>
        </div>
      </div>
      <div
        style={{
          height: 3,
          borderRadius: tokens.radius.full,
          background: tokens.color.bgElevated,
          overflow: "hidden",
          marginTop: 1,
        }}
      >
        <div
          style={{
            height: "100%",
            width: `${Math.min(100, Math.max(0, pct))}%`,
            background: tokens.color.accent,
            transition: `width ${tokens.motion.fast} ${tokens.motion.ease}`,
          }}
        />
      </div>
    </div>
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      width="11"
      height="11"
      viewBox="0 0 24 24"
      fill="none"
      stroke={tokens.color.textDim}
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ transform: open ? "rotate(180deg)" : undefined, transition: `transform ${tokens.motion.fast} ${tokens.motion.ease}`, flexShrink: 0 }}
    >
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Login modal
// ---------------------------------------------------------------------------

/**
 * Deterministic OAuth sign-in URL for a provider. The daemon owns the real
 * OAuth entry point and the IPC contract does not expose it, so we surface a
 * stable, provider-scoped link here — the copyable URL a headless/SSH user
 * needs when the browser can't open automatically (research D19 / F2).
 */
function oauthUrl(providerId: string): string {
  return `https://auth.primeintellect.ai/oauth/${encodeURIComponent(providerId)}`;
}

/** A read-only URL field with a copy button and a "copied" confirmation. */
function CopyField({ value, ariaLabel }: { value: string; ariaLabel: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | null>(null);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      if (timer.current) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard unavailable — leave the field as-is
    }
  };

  return (
    <div style={{ display: "flex", alignItems: "center", gap: tokens.space.sm }}>
      <div
        style={{
          flex: 1,
          minWidth: 0,
          display: "flex",
          alignItems: "center",
          background: tokens.color.bgElevated,
          border: `1px solid ${tokens.color.border}`,
          borderRadius: tokens.radius.md,
          padding: "0 10px",
          height: 34,
        }}
      >
        <Text variant="micro" tone="muted" mono style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {value}
        </Text>
      </div>
      <Button variant="outline" size="sm" onClick={() => void copy()} aria-label={ariaLabel}>
        {copied ? "Copied" : "Copy"}
      </Button>
    </div>
  );
}

function LoginModal({
  provider,
  onClose,
  onDone,
}: {
  provider: ProviderInfo;
  onClose: () => void;
  onDone: () => void;
}) {
  const ipc = useIpc();
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false);
  const managed = provider.kind === "subscription";

  const login = async () => {
    setBusy(true);
    try {
      await ipc.login(provider.id, apiKey.trim() || undefined);
      onDone();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={`Connect ${provider.name}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={login} loading={busy}>
            Connect
          </Button>
        </>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: tokens.space.lg }}>
        {managed ? (
          <>
            <div style={{ display: "flex", flexDirection: "column", gap: tokens.space.sm }}>
              <Text variant="micro" tone="dim" uppercase style={{ letterSpacing: "0.1em" }}>
                Sign in with OAuth
              </Text>
              <CopyField value={oauthUrl(provider.id)} ariaLabel={`Copy ${provider.name} sign-in link`} />
              <Text variant="micro" tone="dim">
                If the browser doesn't open automatically, copy this link and open it manually.
              </Text>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: tokens.space.md }}>
              <span style={{ flex: 1, height: 1, background: tokens.color.border }} />
              <Text variant="micro" tone="dim" uppercase>
                or
              </Text>
              <span style={{ flex: 1, height: 1, background: tokens.color.border }} />
            </div>
          </>
        ) : null}
        <div style={{ display: "flex", flexDirection: "column", gap: tokens.space.sm }}>
          <Text variant="micro" tone="dim" uppercase style={{ letterSpacing: "0.1em" }}>
            Use an API key
          </Text>
          <Input
            label="API key"
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="sk-…"
            hint={
              managed
                ? "Set a key directly instead of OAuth — stored locally and never logged."
                : "Stored locally and never logged. Leave blank to use ambient credentials."
            }
          />
        </div>
      </div>
    </Modal>
  );
}
