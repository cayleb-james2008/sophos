// FirstRunExperience — a full-stage welcome sequence for a non-technical user.
// The engine/provider health logic remains shared with the composer; this file
// only changes the first-run presentation and the path into provider setup.

import { useCallback, useEffect, useRef, useState } from "react";
import { useIpc, isTauri } from "../../ipc/client";
import type { ModelInfo, ProviderInfo, RuntimeInfo } from "../../ipc/contract";
import { DEFAULT_MODEL, DEFAULT_PROVIDER } from "../providers/useModels";
import "./onboarding.css";

const DISMISS_KEY = "sophos.onboardingDismissed.v1";
const FIRST_MESSAGE_KEY = "sophos.hasFirstMessage.v1";

function readFlag(key: string): boolean {
  try { return window.localStorage.getItem(key) === "1"; }
  catch { return false; }
}
function writeFlag(key: string): void {
  try { window.localStorage.setItem(key, "1"); }
  catch { /* best-effort persistence */ }
}

export type SetupCheckState = "checking" | "ready" | "waiting" | "preview";
export interface SetupCheck { label: string; state: SetupCheckState; detail: string; }
export interface OnboardingStatus {
  checks: SetupCheck[];
  ready: boolean;
  hasProvider: boolean;
  hasFreeProvider: boolean;
  refresh: () => void;
}

interface EngineStatus { daemon_alive: boolean; sidecar_alive: boolean; }

async function getEngineStatus(): Promise<EngineStatus | null> {
  if (!isTauri) return null;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke<EngineStatus>("get_engine_status");
  } catch { return null; }
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
function friendlyCheckLabel(label: string): string { return FRIENDLY_CHECK_LABELS[label] ?? label; }

/** Shared health state used by the experience and the composer gate. */
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
  setup: OnboardingStatus;
}


function Archetype({ mark, title, detail }: { mark: string; title: string; detail: string }) {
  return (
    <div className="pa-onboarding__archetype">
      <span className="pa-onboarding__archetype-mark" aria-hidden="true">{mark}</span>
      <div className="pa-onboarding__archetype-copy">
        <span className="pa-onboarding__archetype-title">{title}</span>
        <span className="pa-onboarding__archetype-detail">{detail}</span>
      </div>
    </div>
  );
}

function CheckRail({ checks }: { checks: SetupCheck[] }) {
  return (
    <div className="pa-onboarding__checks" data-testid="onboarding-prerequisites">
      {checks.map((check) => {
        const stateClass = check.state === "ready" ? "--ready" : check.state === "preview" ? "--preview" : "";
        return (
          <span key={check.label} className="pa-onboarding__check" title={`${friendlyCheckLabel(check.label)}: ${check.detail}`}>
            <span className={`pa-onboarding__check-dot${stateClass}`} aria-hidden="true" />
            {friendlyCheckLabel(check.label)}
          </span>
        );
      })}
    </div>
  );
}

export function FirstRunExperience({ onSetupProviders, onStartChat, hasFirstMessage = false, setup }: FirstRunBannerProps): JSX.Element | null {
  const [dismissed, setDismissed] = useState(() => readFlag(DISMISS_KEY));
  const completed = hasFirstMessage || readFlag(FIRST_MESSAGE_KEY);
  const health = setup;

  const dismiss = () => {
    writeFlag(DISMISS_KEY);
    setDismissed(true);
  };
  const beginChat = () => {
    dismiss();
    onStartChat?.();
  };
  const openProviderSetup = () => onSetupProviders?.();

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

  const providerReady = health.hasFreeProvider;
  const liveReady = health.ready;
  const preview = !isTauri;
  const title = preview
    ? <>A quieter way to <em>think</em>.</>
    : !providerReady
      ? <>Meet your new <em>thinking space</em>.</>
      : liveReady
        ? <>Your workspace is <em>ready</em>.</>
        : <>The engine is finding its <em>rhythm</em>.</>;
  const lede = preview
    ? "Sophos brings an open, local-first coding agent into a focused Windows workspace. Try the flow, then connect your own engine when you’re ready."
    : !providerReady
      ? "Start with one free model. Connect DeepSeek V4 Flash 0731 once, and Sophos will take care of the rest."
      : liveReady
        ? "The engine and model are ready. Your first conversation is one click away."
        : "Your provider is connected. Keep this window open while the local engine finishes starting.";
  const statusTitle = preview ? "Preview workspace" : liveReady ? "All systems ready" : providerReady ? "Starting local workspace" : "One small setup step";
  const statusDetail = preview ? "Simulated responses · no files or network calls" : liveReady ? "DeepSeek V4 Flash 0731 · ready to chat" : providerReady ? "Daemon · bridge · kernel · model" : "Connect the free starter model to continue";

  return (
    <section className="pa-onboarding" role="dialog" aria-modal="true" aria-labelledby="sophos-onboarding-title">
      <div className="pa-onboarding__frame">
        <span className="pa-onboarding__edge" aria-hidden="true" />
        <div className="pa-onboarding__topline">
          <div className="pa-onboarding__brand"><span className="pa-onboarding__brand-mark">Σ</span> SOPHOS</div>
          <span className="pa-onboarding__eyebrow">First run / Windows</span>
        </div>

        <div className="pa-onboarding__body">
          <div className="pa-onboarding__hero">
            <div className="pa-onboarding__kicker">Open intelligence workspace</div>
            <h1 className="pa-onboarding__title" id="sophos-onboarding-title">{title}</h1>
            <p className="pa-onboarding__lede">{lede}</p>
            <div className="pa-onboarding__actions">
              {preview ? (
                <button type="button" className="pa-onboarding__action-primary" onClick={beginChat}>Start a preview</button>
              ) : !providerReady ? (
                <button type="button" className="pa-onboarding__action-primary" onClick={openProviderSetup}>Set up free model</button>
              ) : liveReady ? (
                <button type="button" className="pa-onboarding__action-primary" onClick={beginChat}>Start your first chat</button>
              ) : (
                <button type="button" className="pa-onboarding__action-primary" onClick={health.refresh}>Check workspace</button>
              )}
              <button type="button" className="pa-onboarding__action-secondary" onClick={dismiss}>Skip for now</button>
            </div>
          </div>

          <aside className="pa-onboarding__aside" aria-label="Sophos surface archetypes">
            <div className="pa-onboarding__aside-label">Three surfaces / one flow</div>
            <div className="pa-onboarding__archetypes">
              <Archetype mark="01" title="Chat / Operate" detail="A focused transcript where ideas become working code." />
              <Archetype mark="02" title="SystemBar / Monitor" detail="A calm glance at engine, model, and context." />
              <Archetype mark="03" title="Settings / Configure" detail="A precise place to connect providers and tune the workspace." />
            </div>
          </aside>
        </div>

        <footer className="pa-onboarding__footer">
          <div className="pa-onboarding__status">
            <span className={`pa-onboarding__status-dot${liveReady ? " pa-onboarding__status-dot--ready" : ""}`} aria-hidden="true" />
            <div className="pa-onboarding__status-copy">
              <span className="pa-onboarding__status-title">{statusTitle}</span>
              <span className="pa-onboarding__status-detail">{statusDetail}</span>
            </div>
          </div>
          <CheckRail checks={health.checks} />
          <button type="button" className="pa-onboarding__skip" onClick={dismiss}>Esc to dismiss</button>
        </footer>
      </div>
    </section>
  );
}

// Keep the old export stable for any feature or test importing the original name.
export const FirstRunBanner = FirstRunExperience;
