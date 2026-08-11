// FirstRunBanner — guided first-run onboarding for a non-technical user.
//
// The live Tauri path checks the managed Node processes, daemon, bridge,
// persistent kernel, and the default free DeepSeek model before enabling the
// first prompt. Browser preview remains explicitly marked as preview so it
// never masquerades as a live health check.

import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { tokens } from "../../design/tokens";
import { Text, Button, Badge } from "../../design";
import { useIpc, isTauri } from "../../ipc/client";
import type { ModelInfo, ProviderInfo, RuntimeInfo } from "../../ipc/contract";
import { DEFAULT_MODEL, DEFAULT_PROVIDER } from "../providers/useModels";
import { KeyIcon } from "../sessions/icons";

const DISMISS_KEY = "sophos.onboardingDismissed.v1";
const FIRST_MESSAGE_KEY = "sophos.hasFirstMessage.v1";

function readFlag(key: string): boolean {
  try {
    return window.localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}
function writeFlag(key: string): void {
  try {
    window.localStorage.setItem(key, "1");
  } catch {
    // best-effort persistence
  }
}

export type SetupCheckState = "checking" | "ready" | "waiting" | "preview";

export interface SetupCheck {
  label: string;
  state: SetupCheckState;
  detail: string;
}

export interface OnboardingStatus {
  checks: SetupCheck[];
  ready: boolean;
  hasProvider: boolean;
  hasFreeProvider: boolean;
  refresh: () => void;
}

interface EngineStatus {
  daemon_alive: boolean;
  sidecar_alive: boolean;
}

/** The Rust shell owns this command; browser preview intentionally returns null. */
async function getEngineStatus(): Promise<EngineStatus | null> {
  if (!isTauri) return null;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke<EngineStatus>("get_engine_status");
  } catch {
    return null;
  }
}

function liveCheck(label: string, ok: boolean, readyDetail: string, waitingDetail: string): SetupCheck {
  return { label, state: ok ? "ready" : "waiting", detail: ok ? readyDetail : waitingDetail };
}

const FRIENDLY_CHECK_LABELS: Record<string, string> = {
  "Node runtime": "App engine",
  Daemon: "Agent service",
  Bridge: "Connection",
  Kernel: "Python workspace",
  "Free model": "Free model",
};

function friendlyCheckLabel(label: string): string {
  return FRIENDLY_CHECK_LABELS[label] ?? label;
}

/** Shared health state used by both the banner and the composer gate. */
export function useOnboardingStatus(): OnboardingStatus {
  const ipc = useIpc();
  const [checks, setChecks] = useState<SetupCheck[]>(() =>
    isTauri
      ? ["Node runtime", "Daemon", "Bridge", "Kernel", "Free model"].map((label) => ({ label, state: "checking", detail: "Checking…" }))
      : ["Node runtime", "Daemon", "Bridge", "Kernel", "Free model"].map((label) => ({ label, state: "preview", detail: "Browser preview" })),
  );
  const [hasProvider, setHasProvider] = useState(!isTauri);
  const [hasFreeProvider, setHasFreeProvider] = useState(!isTauri);
  const refreshGeneration = useRef(0);

  const refresh = useCallback(() => {
    const generation = ++refreshGeneration.current;
    if (!isTauri) {
      setChecks(["Node runtime", "Daemon", "Bridge", "Kernel", "Free model"].map((label) => ({ label, state: "preview", detail: "Browser preview" })));
      setHasProvider(true);
      setHasFreeProvider(true);
      return;
    }
    void Promise.allSettled([getEngineStatus(), ipc.getRuntimeInfo(), ipc.getProviders(), ipc.getModels()]).then((results) => {
      if (generation !== refreshGeneration.current) return;
      const engine = results[0].status === "fulfilled" ? results[0].value : null;
      const runtime = results[1].status === "fulfilled" ? results[1].value as RuntimeInfo : undefined;
      const providers = results[2].status === "fulfilled" ? results[2].value as ProviderInfo[] : [];
      const models = results[3].status === "fulfilled" ? results[3].value as ModelInfo[] : [];
      const daemon = engine?.daemon_alive === true;
      const bridge = engine?.sidecar_alive === true;
      const hasConnectedProvider = providers.some((item) => item.connected);
      const hasConnectedFreeProvider = providers.some((item) => item.id === DEFAULT_PROVIDER && item.connected);
      const model = models.some((item) => item.provider === DEFAULT_PROVIDER && item.id === DEFAULT_MODEL);
      const kernel = runtime?.kernel.status === "configured" && runtime.kernel.toolAvailable;
      setHasProvider(hasConnectedProvider);
      setHasFreeProvider(hasConnectedFreeProvider);
      setChecks([
        liveCheck("Node runtime", daemon || bridge, "Detected via managed engine processes", "Waiting for the managed Node processes"),
        liveCheck("Daemon", daemon, "Running", "Starting the agent daemon"),
        liveCheck("Bridge", bridge, "Connected", "Starting the IPC bridge"),
        liveCheck("Kernel", kernel, "Persistent IPython ready", "Kernel is still booting"),
        liveCheck("Free model", hasConnectedProvider && model, "DeepSeek V4 Flash 0731 ready", "Connect Ollama Cloud to use DeepSeek V4 Flash 0731"),
      ]);
    });
  }, [ipc]);

  useEffect(() => {
    refresh();
    if (!isTauri) return;
    const timer = window.setInterval(refresh, 2500);
    return () => {
      window.clearInterval(timer);
      // Invalidate an in-flight refresh so it cannot publish state after this
      // hook unmounts or after a newer refresh has started.
      refreshGeneration.current += 1;
    };
  }, [refresh]);

  const ready = !isTauri || checks.every((check) => check.state === "ready");
  return { checks, ready, hasProvider, hasFreeProvider, refresh };
}

export interface FirstRunBannerProps {
  onSetupProviders?: () => void;
  onStartChat?: () => void;
  hasFirstMessage?: boolean;
  /** Shared health snapshot; ChatView also uses it to gate the composer. */
  setup: OnboardingStatus;
}

function CheckList({ checks }: { checks: SetupCheck[] }) {
  return (
    <div
      data-testid="onboarding-prerequisites"
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))",
        gap: tokens.space.xs,
        width: "100%",
        marginTop: tokens.space.sm,
      }}
    >
      {checks.map((check) => {
        const live = check.state === "ready";
        const preview = check.state === "preview";
        return (
          <div
            key={check.label}
            title={`${friendlyCheckLabel(check.label)}: ${check.detail}`}
            aria-label={`${friendlyCheckLabel(check.label)}: ${check.detail}`}
            style={{ display: "flex", alignItems: "center", gap: tokens.space.xs, minWidth: 0 }}
          >
            <span style={{ width: 6, height: 6, flexShrink: 0, borderRadius: "50%", background: live ? tokens.color.success : preview ? tokens.color.textDim : tokens.color.warning }} />
            <Text variant="micro" tone={live ? "success" : preview ? "dim" : "warning"} style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {friendlyCheckLabel(check.label)}
            </Text>
          </div>
        );
      })}
    </div>
  );
}

export function FirstRunBanner({ onSetupProviders, onStartChat, hasFirstMessage = false, setup }: FirstRunBannerProps): JSX.Element | null {
  const [dismissed, setDismissed] = useState<boolean>(() => readFlag(DISMISS_KEY));
  const completed = hasFirstMessage || readFlag(FIRST_MESSAGE_KEY);
  // Keep the banner and composer on the same health snapshot. ChatView owns
  // the polling hook so this component does not start a second timer/request
  // stream for the same daemon state.
  const health = setup;

  const dismiss = () => {
    writeFlag(DISMISS_KEY);
    setDismissed(true);
  };

  useEffect(() => {
    if (dismissed || completed) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "TEXTAREA" || target.tagName === "INPUT")) return;
      dismiss();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dismissed, completed]);

  if (completed || dismissed) return null;

  const stripStyle: CSSProperties = {
    flexShrink: 0,
    display: "flex",
    alignItems: "center",
    gap: tokens.space.lg,
    padding: `${tokens.space.md} ${tokens.space.xl}`,
    borderBottom: `1px solid ${tokens.color.border}`,
    background: `linear-gradient(180deg, ${tokens.color.bgElevated}cc, transparent)`,
  };
  const icon = (
    <span style={{ width: 30, height: 30, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", borderRadius: tokens.radius.md, background: tokens.color.accentSoft, border: `1px solid ${tokens.color.accentBorder}`, color: tokens.color.accentHover }}>
      <KeyIcon size={15} />
    </span>
  );
  const copy = (title: string, body: string) => (
    <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0, flex: 1 }}>
      <Text variant="label" weight="semibold">{title}</Text>
      <Text variant="body" tone="muted">{body}</Text>
      <CheckList checks={health.checks} />
    </div>
  );
  const actions = (children: ReactNode) => <div style={{ display: "flex", alignItems: "center", gap: tokens.space.sm, flexShrink: 0, flexWrap: "wrap", justifyContent: "flex-end" }}>{children}</div>;
  const providerReady = health.hasFreeProvider;

  if (!isTauri) {
    return (
      <div className="pa-firstrun" role="region" aria-label="First-run setup" style={stripStyle}>
        {icon}
        {copy("Preview mode", "This browser preview uses simulated responses. It does not connect to DeepSeek V4 Flash 0731 or your files; use a starter prompt to try the flow.")}
        {actions(
          <>
            <Badge tone="warning" dot>Preview only</Badge>
            <Button variant="primary" size="sm" onClick={onStartChat}>Start typing</Button>
            <Button variant="ghost" size="sm" onClick={dismiss}>Dismiss</Button>
          </>,
        )}
      </div>
    );
  }

  if (!providerReady) {
    return (
      <div className="pa-firstrun" role="region" aria-label="First-run setup" style={stripStyle}>
        {icon}
        {copy("Welcome to Sophos", "Connect the free Ollama Cloud model once — no config files to edit. Sophos will use DeepSeek V4 Flash 0731 for your first chat.")}
        {actions(
          <>
            <Button variant="primary" size="sm" onClick={onSetupProviders}>Connect free DeepSeek</Button>
            <Button variant="ghost" size="sm" onClick={health.refresh}>Check again</Button>
            <Button variant="ghost" size="sm" onClick={dismiss}>Skip</Button>
          </>,
        )}
      </div>
    );
  }

  const liveReady = health.ready;
  return (
    <div className="pa-firstrun" role="region" aria-label="First-run setup" style={stripStyle}>
      {icon}
      {copy(liveReady ? "You're ready" : "Finish setup before your first chat", liveReady ? "DeepSeek V4 Flash 0731 is connected. Start your first conversation." : "Keep this window open until the app engine, connection, Python workspace, and model are ready.")}
      {actions(
        <>
          <Badge tone={liveReady ? "success" : "warning"} dot>{liveReady ? "Ready" : "Starting"}</Badge>
          {!liveReady && <Button variant="outline" size="sm" onClick={onSetupProviders}>Open setup</Button>}
          {liveReady && <Button variant="primary" size="sm" onClick={onStartChat}>Start chatting</Button>}
          <Button variant="ghost" size="sm" onClick={dismiss}>{liveReady ? "Dismiss" : "Skip"}</Button>
        </>,
      )}
    </div>
  );
}
