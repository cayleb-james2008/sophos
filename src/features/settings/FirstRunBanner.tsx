// FirstRunBanner — a skippable, provider-first first-run onboarding strip.
//
// Upstream users complained the first-run experience gave no indication you
// could skip login and set API keys directly (GitHub #992 / research D12, F1).
// This banner is the Sophos answer: a clearly-skippable affordance that points
// at Settings → Providers as the primary path and explains that API keys can
// be set directly rather than via OAuth. It is an inline strip, not a modal —
// it never traps the user. Dismissal persists to localStorage.

import { useEffect, useState } from "react";
import { tokens } from "../../design/tokens";
import { Text, Button } from "../../design";
import { KeyIcon } from "../sessions/icons";

const DISMISS_KEY = "sophos.onboardingDismissed.v1";

function readDismissed(): boolean {
  try {
    return window.localStorage.getItem(DISMISS_KEY) === "1";
  } catch {
    return false;
  }
}

export function FirstRunBanner({ onSetupProviders }: { onSetupProviders?: () => void }) {
  const [dismissed, setDismissed] = useState<boolean>(() => readDismissed());

  const dismiss = () => {
    try {
      window.localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      // best-effort — the banner just stays until the next reload
    }
    setDismissed(true);
  };

  // ESC to skip — but never steal Escape from the composer textarea.
  useEffect(() => {
    if (dismissed) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "TEXTAREA" || t.tagName === "INPUT")) return;
      dismiss();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dismissed]);

  if (dismissed) return null;

  return (
    <div
      role="region"
      aria-label="First-run setup"
      style={{
        flexShrink: 0,
        display: "flex",
        alignItems: "center",
        gap: tokens.space.lg,
        padding: `${tokens.space.md} ${tokens.space.xl}`,
        borderBottom: `1px solid ${tokens.color.border}`,
        background: `linear-gradient(180deg, ${tokens.color.bgElevated}cc, transparent)`,
      }}
    >
      <span
        style={{
          width: 30,
          height: 30,
          flexShrink: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          borderRadius: tokens.radius.md,
          background: tokens.color.accentSoft,
          border: `1px solid ${tokens.color.accentBorder}`,
          color: tokens.color.accentHover,
        }}
      >
        <KeyIcon size={15} />
      </span>

      <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0, flex: 1 }}>
        <Text variant="label" weight="semibold">
          Welcome to Sophos
        </Text>
        <Text variant="body" tone="muted">
          Connect a provider to start. Sign in with OAuth or set an API key directly — no account required.
        </Text>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: tokens.space.sm, flexShrink: 0 }}>
        <Button variant="primary" size="sm" onClick={onSetupProviders}>
          Set up providers
        </Button>
        <Button variant="ghost" size="sm" onClick={dismiss}>
          Skip
        </Button>
        <Text variant="micro" tone="dim" mono>
          ESC to skip
        </Text>
      </div>
    </div>
  );
}
