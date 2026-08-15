// OnboardingWizard — a guided, step-by-step first-run sequence that replaces
// the static FirstRunBanner. Walks a new user through Welcome → Connect a
// Provider → Pick a Model → First Prompt, with a visual progress indicator and
// a "Skip" option at every step. Reuses the shared health state from
// useOnboardingStatus() (exported from FirstRunBanner.tsx) and the existing
// dismiss/completion localStorage flags, so it can be re-launched from
// Settings → General → "Run onboarding again".

import { useCallback, useEffect, useState } from "react";
import { Button, Text, Badge, StatusDot } from "../../design";
import { useConnectionState, isTauri, isDemoShell } from "../../ipc/client";
import { useModels, DEFAULT_PROVIDER, DEFAULT_MODEL } from "../providers/useModels";
import type { OnboardingStatus } from "./FirstRunBanner";
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

const STEPS = ["welcome", "provider", "model", "firstPrompt"] as const;
type Step = (typeof STEPS)[number];

const STEP_INDEX: Record<Step, number> = { welcome: 0, provider: 1, model: 2, firstPrompt: 3 };

export interface OnboardingWizardProps {
  onSetupProviders?: () => void;
  onStartChat?: () => void;
  hasFirstMessage?: boolean;
  setup: OnboardingStatus;
}

export function OnboardingWizard({ onSetupProviders, onStartChat, hasFirstMessage = false, setup }: OnboardingWizardProps): JSX.Element | null {
  const [dismissed, setDismissed] = useState(() => readFlag(DISMISS_KEY));
  const [step, setStep] = useState<Step>("welcome");
  const completed = hasFirstMessage || readFlag(FIRST_MESSAGE_KEY) || isDemoShell();
  const health = setup;
  const preview = !isTauri;

  const dismiss = useCallback(() => {
    writeFlag(DISMISS_KEY);
    setDismissed(true);
  }, []);

  const beginChat = useCallback(() => {
    dismiss();
    onStartChat?.();
  }, [dismiss, onStartChat]);

  const openProviderSetup = useCallback(() => onSetupProviders?.(), [onSetupProviders]);

  // Esc dismisses from any step (unless typing in an input).
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
  }, [dismissed, completed, dismiss]);

  if (completed || dismissed) return null;

  const stepIndex = STEP_INDEX[step];
  const providerReady = health.hasFreeProvider || health.hasProvider;
  const liveReady = health.ready;

  return (
    <section className="pa-onboarding" role="dialog" aria-modal="true" aria-labelledby="sophos-onboarding-title">
      <div className="pa-onboarding__frame">
        <span className="pa-onboarding__edge" aria-hidden="true" />
        <div className="pa-onboarding__topline">
          <div className="pa-onboarding__brand"><span className="pa-onboarding__brand-mark">Σ</span> SOPHOS</div>
          <span className="pa-onboarding__eyebrow">First run / Windows</span>
        </div>

        <div className="pa-onboarding__steps" role="tablist" aria-label="Onboarding progress">
          {STEPS.map((s, i) => (
            <span
              key={s}
              role="tab"
              aria-selected={i === stepIndex}
              className={`pa-onboarding__step${i === stepIndex ? " pa-onboarding__step--active" : ""}${i < stepIndex ? " pa-onboarding__step--done" : ""}`}
            >
              <span className="pa-onboarding__step-index" aria-hidden="true">{i + 1}</span>
              <span className="pa-onboarding__step-label">{stepLabel(s)}</span>
            </span>
          ))}
        </div>

        <div className="pa-onboarding__wizard-body">
          {step === "welcome" ? (
            <WelcomeStep preview={preview} onNext={() => setStep("provider")} onSkip={dismiss} />
          ) : step === "provider" ? (
            <ProviderStep
              providerReady={providerReady}
              preview={preview}
              onConnect={openProviderSetup}
              onNext={() => setStep("model")}
              onBack={() => setStep("welcome")}
              onSkip={dismiss}
            />
          ) : step === "model" ? (
            <ModelStep onNext={() => setStep("firstPrompt")} onBack={() => setStep("provider")} onSkip={dismiss} />
          ) : (
            <FirstPromptStep onStart={beginChat} onBack={() => setStep("model")} onSkip={dismiss} />
          )}
        </div>

        <footer className="pa-onboarding__footer">
          <div className="pa-onboarding__status">
            <span className={`pa-onboarding__status-dot${liveReady ? " pa-onboarding__status-dot--ready" : ""}`} aria-hidden="true" />
            <div className="pa-onboarding__status-copy">
              <span className="pa-onboarding__status-title">{preview ? "Preview workspace" : liveReady ? "All systems ready" : "Starting local workspace"}</span>
              <span className="pa-onboarding__status-detail">{preview ? "Simulated responses · no files or network calls" : liveReady ? "DeepSeek V4 Flash 0731 · ready to chat" : "Daemon · bridge · kernel · model"}</span>
            </div>
          </div>
          <Button type="button" variant="ghost" className="pa-onboarding__skip" onClick={dismiss}>Skip · Esc to dismiss</Button>
        </footer>
      </div>
    </section>
  );
}

function stepLabel(step: Step): string {
  switch (step) {
    case "welcome": return "Welcome";
    case "provider": return "Provider";
    case "model": return "Model";
    case "firstPrompt": return "First prompt";
  }
}

// ---------------------------------------------------------------------------
// Step bodies
// ---------------------------------------------------------------------------

function WelcomeStep({ preview, onNext, onSkip }: { preview: boolean; onNext: () => void; onSkip: () => void }) {
  return (
    <div className="pa-onboarding__wizard">
      <div className="pa-onboarding__kicker">Open intelligence workspace</div>
      <h1 className="pa-onboarding__title" id="sophos-onboarding-title">
        {preview ? <>A quieter way to <em>think</em>.</> : <>Meet your new <em>thinking space</em>.</>}
      </h1>
      <p className="pa-onboarding__lede">
        {preview
          ? "Sophos brings an open, local-first coding agent into a focused Windows workspace. Walk through the setup, then connect your own engine when you're ready."
          : "Four quick steps and you'll be talking to your agent. Connect a provider, pick a model, and send your first prompt."}
      </p>
      <div className="pa-onboarding__actions">
        <Button type="button" variant="primary" className="pa-onboarding__action-primary" onClick={onNext}>Get started</Button>
        <Button type="button" variant="ghost" className="pa-onboarding__action-secondary" onClick={onSkip}>Skip for now</Button>
      </div>
    </div>
  );
}

function ProviderStep({
  providerReady, preview, onConnect, onNext, onBack, onSkip,
}: {
  providerReady: boolean; preview: boolean;
  onConnect: () => void; onNext: () => void; onBack: () => void; onSkip: () => void;
}) {
  return (
    <div className="pa-onboarding__wizard">
      <div className="pa-onboarding__kicker">Step 2 of 4</div>
      <h1 className="pa-onboarding__title" id="sophos-onboarding-title">Connect a <em>provider</em>.</h1>
      <p className="pa-onboarding__lede">
        {providerReady
          ? "A provider is already connected. Your agent has somewhere to run."
          : "Connect a provider to give your agent a model to think with. The free starter model is the fastest way in."}
      </p>

      <div className="pa-onboarding__provider-status">
        <StatusDot state={providerReady ? "connected" : "disconnected"} />
        <div className="pa-onboarding__provider-copy">
          <span className="pa-onboarding__provider-title">{providerReady ? "Provider connected" : "No provider connected"}</span>
          <span className="pa-onboarding__provider-detail">
            {preview
              ? "Browser preview · simulated provider"
              : providerReady
                ? "Ready to route requests to your model"
                : "Connect one to continue"}
          </span>
        </div>
        {providerReady ? <Badge tone="success" dot>Connected</Badge> : <Badge tone="neutral" dot>Offline</Badge>}
      </div>

      <div className="pa-onboarding__actions">
        {providerReady ? (
          <Button type="button" variant="primary" className="pa-onboarding__action-primary" onClick={onNext}>Next</Button>
        ) : (
          <Button type="button" variant="primary" className="pa-onboarding__action-primary" onClick={onConnect}>Connect a provider</Button>
        )}
        <Button type="button" variant="ghost" className="pa-onboarding__action-secondary" onClick={onBack}>Back</Button>
        <Button type="button" variant="ghost" className="pa-onboarding__action-secondary" onClick={onSkip}>Skip</Button>
      </div>
    </div>
  );
}

function ModelStep({ onNext, onBack, onSkip }: { onNext: () => void; onBack: () => void; onSkip: () => void }) {
  const state = useConnectionState();
  const { models, providers, setModel } = useModels();
  const current = state.model?.provider && state.model?.model
    ? { provider: state.model.provider, model: state.model.model }
    : { provider: DEFAULT_PROVIDER, model: DEFAULT_MODEL };
  const currentModel = models.find((m) => m.id === current.model && m.provider === current.provider);
  const hasSelection = !!currentModel;

  const grouped = providers
    .map((p) => ({ provider: p, models: models.filter((m) => m.provider === p.id) }))
    .filter((g) => g.models.length > 0);

  return (
    <div className="pa-onboarding__wizard">
      <div className="pa-onboarding__kicker">Step 3 of 4</div>
      <h1 className="pa-onboarding__title" id="sophos-onboarding-title">Pick a <em>model</em>.</h1>
      <p className="pa-onboarding__lede">
        {hasSelection
          ? `Your current model is ${currentModel?.name ?? current.model}. You can change it any time from the chat header.`
          : "Choose a model to power your conversations. You can switch it any time from the chat header."}
      </p>

      {hasSelection ? (
        <div className="pa-onboarding__model-current">
          <span className="pa-onboarding__model-current-name">{currentModel?.name ?? current.model}</span>
          <span className="pa-onboarding__model-current-meta">
            {current.provider}
            {currentModel?.contextWindow ? ` · ${currentModel.contextWindow.toLocaleString()} ctx` : ""}
          </span>
          <Badge tone="success" dot>Selected</Badge>
        </div>
      ) : (
        <div className="pa-onboarding__model-list" role="listbox" aria-label="Available models">
          {grouped.length === 0 ? (
            <Text variant="label" tone="muted">No models available yet — connect a provider first.</Text>
          ) : (
            grouped.map((group) => (
              <div key={group.provider.id} className="pa-onboarding__model-group">
                <span className="pa-onboarding__model-group-label">{group.provider.name}</span>
                {group.models.map((m) => (
                  <button
                    key={`${m.provider}:${m.id}`}
                    type="button"
                    role="option"
                    aria-selected={m.id === current.model && m.provider === current.provider}
                    className="pa-onboarding__model-option"
                    onClick={() => void setModel(m.provider, m.id)}
                  >
                    <span className="pa-onboarding__model-option-name">{m.name ?? m.id}</span>
                    {m.contextWindow ? (
                      <span className="pa-onboarding__model-option-meta">{m.contextWindow.toLocaleString()} ctx</span>
                    ) : null}
                  </button>
                ))}
              </div>
            ))
          )}
        </div>
      )}

      <div className="pa-onboarding__actions">
        <Button type="button" variant="primary" className="pa-onboarding__action-primary" onClick={onNext}>Next</Button>
        <Button type="button" variant="ghost" className="pa-onboarding__action-secondary" onClick={onBack}>Back</Button>
        <Button type="button" variant="ghost" className="pa-onboarding__action-secondary" onClick={onSkip}>Skip</Button>
      </div>
    </div>
  );
}

function FirstPromptStep({ onStart, onBack, onSkip }: { onStart: () => void; onBack: () => void; onSkip: () => void }) {
  return (
    <div className="pa-onboarding__wizard">
      <div className="pa-onboarding__kicker">Step 4 of 4</div>
      <h1 className="pa-onboarding__title" id="sophos-onboarding-title">Your first <em>prompt</em>.</h1>
      <p className="pa-onboarding__lede">
        You're all set. The composer is ready below — ask anything, and Sophos will take it from there.
      </p>
      <div className="pa-onboarding__actions">
        <Button type="button" variant="primary" className="pa-onboarding__action-primary" onClick={onStart}>Start chatting</Button>
        <Button type="button" variant="ghost" className="pa-onboarding__action-secondary" onClick={onBack}>Back</Button>
        <Button type="button" variant="ghost" className="pa-onboarding__action-secondary" onClick={onSkip}>Skip</Button>
      </div>
    </div>
  );
}
