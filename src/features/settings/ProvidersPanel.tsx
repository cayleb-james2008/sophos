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

import { useEffect, useRef, useState } from "react";
import { tokens } from "../../design/tokens";
import { Text, Card, Badge, Button, Modal, Input, Select, Spinner } from "../../design";
import { useIpc } from "../../ipc/client";
import type { LocalProviderConfig, LocalProviderKind, ModelInfo, ProviderInfo, Settings } from "../../ipc/contract";
import { useModels, modelKey } from "../providers/useModels";
import { KeyIcon, LogoutIcon, PlugIcon, CpuIcon } from "../sessions/icons";

export function ProvidersPanel() {
  const ipc = useIpc();
  const { providers, models, loading, reload, setModelConfig, resetModelConfig } = useModels();
  const [loginTarget, setLoginTarget] = useState<ProviderInfo | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [localConfigs, setLocalConfigs] = useState<LocalProviderConfig[]>([]);
  const [localVersion, setLocalVersion] = useState(0);
  const [localOpen, setLocalOpen] = useState(false);

  // Load the persisted local provider config. getSettings/setSettings already
  // carry arbitrary fields, so no new IPC method is needed — we read
  // settings.localProviders here and re-read after connect/disconnect.
  useEffect(() => {
    let mounted = true;
    ipc
      .getSettings()
      .then((s) => {
        if (mounted) setLocalConfigs(s.localProviders ?? []);
      })
      .catch(() => {
        // settings unavailable — local card simply shows disconnected
      });
    return () => {
      mounted = false;
    };
  }, [ipc, localVersion]);

  // A local provider is a single endpoint; treat the first config as the one.
  const localConfig = localConfigs[0] ?? null;

  const providerModels = (p: ProviderInfo): ModelInfo[] =>
    p.models.length ? p.models : models.filter((m) => m.provider === p.id);

  const connectLocal = async (config: LocalProviderConfig) => {
    await ipc.setSettings({ localProviders: [config] } as Settings);
    await ipc.login("local");
    setLocalOpen(false);
    setLocalVersion((v) => v + 1);
    void reload();
  };

  const logoutLocal = async () => {
    await ipc.setSettings({ localProviders: [] } as Settings);
    await ipc.logout("local");
    setLocalVersion((v) => v + 1);
    void reload();
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: tokens.space.lg }}>
      {loading ? (
        <div style={{ display: "flex", justifyContent: "center", padding: tokens.space["3xl"] }}>
          <Spinner size={22} />
        </div>
      ) : (
        <div
          style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: tokens.space.lg }}
        >
          {/* The local (Ollama / OpenAI-compatible) endpoint is a FIRST-CLASS card,
              rendered separately from the daemon-discovered providers so the
              getProviders() array — and its index-0 `ollama-cloud` e2e assumption —
              is never touched. */}
          <LocalProviderCard
            config={localConfig}
            models={models.filter((m) => m.provider === "local")}
            onConnect={() => setLocalOpen(true)}
            onLogout={() => void logoutLocal()}
          />
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

      {localOpen ? <LocalConnectModal onClose={() => setLocalOpen(false)} onConnect={connectLocal} /> : null}
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
        {/* One convention for state, applied to every card (vision-critic D11):
            connection state is ALWAYS the top-right badge, and the kind badge
            (Managed / API key) sits beside it. Previously the kind badge lived
            on a separate row below with a StatusDot that repeated the same
            connection state a second time, so different cards appeared to use
            different visual languages for "state". */}
        {/* The green icon tile already carries "connected"; a green pill beside
            it stated the same fact twice, and across four connected cards that
            stacked into the densest green view in the app (vision-critic
            D1/D2). The pill keeps its dot — which is the state marker — but
            drops to neutral so the signal is said once per card. "Managed" is a
            kind, not a state, so it is neutral too. */}
        <div style={{ display: "flex", alignItems: "center", gap: tokens.space.sm, flexShrink: 0 }}>
          <Badge tone="neutral">{managed ? "Managed" : "API key"}</Badge>
          <Badge tone="neutral" dot dotTone={provider.connected ? "success" : "neutral"}>
            {provider.connected ? "Connected" : "Offline"}
          </Badge>
        </div>
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
                  <Button
                    variant="ghost"
                    type="button"
                    onClick={() => onToggle(key)}
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
                  </Button>

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

      {provider.id === "ollama-cloud" ? (
        <div style={{ display: "flex", flexDirection: "column", gap: tokens.space.xs, padding: tokens.space.md, background: tokens.color.accentSoft, border: `1px solid ${tokens.color.accentBorder}`, borderRadius: tokens.radius.md }}>
          <Text variant="micro" tone="accent" mono uppercase>Free starter model</Text>
          <Text variant="label" weight="semibold">DeepSeek V4 Flash 0731</Text>
          <Text variant="micro" tone="muted">Connect here once; Sophos selects this model automatically for new sessions. No settings file editing required.</Text>
        </div>
      ) : null}

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
          borderRadius: tokens.radius.sm,
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
// Local provider card + connect modal (Ollama / OpenAI-compatible)
// ---------------------------------------------------------------------------

/**
 * First-class card for a local (self-hosted) model endpoint. Unlike the cloud
 * providers it is rendered separately from the `providers` array (it is a
 * user-specified base URL, not a daemon-discovered provider), so it never
 * shifts the getProviders() indices the e2e suite relies on. Uses ONLY the
 * existing design tokens / components — no new colors, sharp corners via
 * tokens.radius.md, Geist type.
 */
function LocalProviderCard({
  config,
  models,
  onConnect,
  onLogout,
}: {
  config: LocalProviderConfig | null;
  models: ModelInfo[];
  onConnect: () => void;
  onLogout: () => void;
}) {
  const connected = !!config;
  const name = config?.name ?? "Local";
  const sub = config ? config.baseUrl : "Not connected";
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
              background: connected ? tokens.color.accentSoft : tokens.color.bgOverlay,
              border: `1px solid ${connected ? tokens.color.accentBorder : tokens.color.border}`,
              color: connected ? tokens.color.accentHover : tokens.color.textDim,
            }}
          >
            <PlugIcon size={17} />
          </span>
          <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
            <Text variant="label" weight="semibold">
              {name}
            </Text>
            <Text variant="micro" tone="dim" mono style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 200 }}>
              {sub}
            </Text>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: tokens.space.sm, flexShrink: 0 }}>
          <Badge tone="neutral">Local</Badge>
          <Badge tone="neutral" dot dotTone={connected ? "success" : "neutral"}>
            {connected ? "Connected" : "Offline"}
          </Badge>
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: tokens.space.sm }}>
        <div style={{ display: "flex", alignItems: "center", gap: tokens.space.sm }}>
          <CpuIcon size={12} color={tokens.color.textDim} />
          <Text variant="micro" tone="dim" uppercase>
            Models
          </Text>
        </div>
        {connected && models.length ? (
          <div style={{ display: "flex", flexDirection: "column", gap: tokens.space.xs }}>
            {models.map((m) => (
              <div
                key={m.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: tokens.space.sm,
                  border: `1px solid ${tokens.color.border}`,
                  borderRadius: tokens.radius.md,
                  background: tokens.color.bgOverlay,
                  padding: "7px 10px",
                }}
              >
                <Text variant="micro" mono style={{ color: tokens.color.textMuted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {m.name ?? m.id}
                </Text>
                <Text variant="micro" tone="dim" mono style={{ flexShrink: 0 }}>
                  {m.contextWindow ? `${m.contextWindow.toLocaleString()} ctx` : ""}
                  {m.contextWindow && m.maxOutputTokens ? ` · ${m.maxOutputTokens.toLocaleString()} out` : ""}
                </Text>
              </div>
            ))}
          </div>
        ) : (
          <Text variant="micro" tone="dim">
            {connected ? "No models reported by endpoint" : "Connect to add local models"}
          </Text>
        )}
      </div>

      <div style={{ borderTop: `1px solid ${tokens.color.border}`, paddingTop: tokens.space.md }}>
        {connected ? (
          <Button variant="outline" size="sm" icon={<LogoutIcon size={13} />} onClick={onLogout}>
            Log out
          </Button>
        ) : (
          <Button variant="accent-soft" size="sm" icon={<PlugIcon size={13} />} onClick={onConnect}>
            Connect
          </Button>
        )}
      </div>
    </Card>
  );
}

/**
 * Connect modal for a local endpoint — takes a base URL + kind instead of an
 * API key. Titled "Connect Local Model" (not "Connect … Cloud") so it never
 * collides with the cloud provider login modal the e2e suite targets.
 */
function LocalConnectModal({
  onClose,
  onConnect,
}: {
  onClose: () => void;
  onConnect: (config: LocalProviderConfig) => void;
}) {
  const [name, setName] = useState("My Local Model");
  const [baseUrl, setBaseUrl] = useState("http://localhost:11434");
  const [kind, setKind] = useState<LocalProviderKind>("ollama");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    try {
      await onConnect({
        id: "local",
        name: name.trim() || "My Local Model",
        baseUrl: baseUrl.trim() || "http://localhost:11434",
        kind,
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Connect Local Model"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={submit} loading={busy}>
            Connect
          </Button>
        </>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: tokens.space.lg }}>
        <Text variant="micro" tone="dim">
          Point Sophos at a local (self-hosted) model endpoint. The config is stored in your settings.
        </Text>
        <Input label="Name" value={name} onChange={(e) => setName(e.target.value)} placeholder="My Local Model" />
        <Input
          label="Base URL"
          value={baseUrl}
          onChange={(e) => setBaseUrl(e.target.value)}
          placeholder="http://localhost:11434"
          hint="e.g. http://localhost:11434 (Ollama) or an OpenAI-compatible base URL."
        />
        <Select
          label="Kind"
          options={[
            { value: "ollama", label: "Ollama" },
            { value: "openai-compatible", label: "OpenAI-compatible" },
          ]}
          value={kind}
          onChange={(e) => setKind(e.target.value as LocalProviderKind)}
        />
      </div>
    </Modal>
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
