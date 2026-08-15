// FirstRunBanner.test.tsx — FirstRunExperience (alias FirstRunBanner) shows the
// welcome sequence unless it has been dismissed or a first message exists, and
// drives the primary action into preview chat / provider setup.

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FirstRunExperience, type OnboardingStatus } from "../FirstRunBanner";

const tauriFlag = vi.hoisted(() => ({ value: false }));

vi.mock("../../../ipc/client", async () => ({
  useIpc: () => ({}),
  useIpcEvent: () => undefined,
  useConnectionState: () => ({ status: { kind: "connected" } }),
  get isTauri() {
    return tauriFlag.value;
  },
}));

function makeSetup(overrides: Partial<OnboardingStatus> = {}): OnboardingStatus {
  return {
    checks: ["Node runtime", "Daemon", "Bridge", "Kernel", "Free model"].map((label) => ({
      label,
      state: "preview",
      detail: "Browser preview",
    })),
    ready: true,
    hasProvider: true,
    hasFreeProvider: true,
    refresh: vi.fn(),
    ...overrides,
  };
}

beforeEach(() => {
  window.localStorage.clear();
});

describe("FirstRunExperience", () => {
  it("renders the preview welcome dialog by default", () => {
    render(<FirstRunExperience setup={makeSetup()} />);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /quieter way to think/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /start a preview/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /skip for now/i })).toBeInTheDocument();
  });

  it("renders the prerequisites rail with the friendly check labels", () => {
    render(<FirstRunExperience setup={makeSetup()} />);
    expect(screen.getByTestId("onboarding-prerequisites")).toBeInTheDocument();
    expect(screen.getByText("App engine")).toBeInTheDocument();
    expect(screen.getByText("Agent service")).toBeInTheDocument();
    expect(screen.getByText("Connection")).toBeInTheDocument();
    expect(screen.getByText("Python workspace")).toBeInTheDocument();
  });

  it("starts a preview chat and dismisses on the primary action", async () => {
    const user = userEvent.setup();
    const onStartChat = vi.fn();
    render(<FirstRunExperience setup={makeSetup()} onStartChat={onStartChat} />);

    await user.click(screen.getByRole("button", { name: /start a preview/i }));

    expect(onStartChat).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("dismisses via 'Skip for now' and persists the dismiss flag", async () => {
    const user = userEvent.setup();
    const { unmount } = render(<FirstRunExperience setup={makeSetup()} />);

    await user.click(screen.getByRole("button", { name: /skip for now/i }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(window.localStorage.getItem("sophos.onboardingDismissed.v1")).toBe("1");

    unmount();
  });

  it("renders nothing when a first message already exists", () => {
    const { container } = render(<FirstRunExperience setup={makeSetup()} hasFirstMessage />);
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing when the dismiss flag is already set", () => {
    window.localStorage.setItem("sophos.onboardingDismissed.v1", "1");
    const { container } = render(<FirstRunExperience setup={makeSetup()} />);
    expect(container.firstChild).toBeNull();
  });

  it("directs a non-preview user to provider setup when no free provider is connected", async () => {
    const user = userEvent.setup();
    tauriFlag.value = true;
    const onSetupProviders = vi.fn();
    const setup = makeSetup({ hasFreeProvider: false, hasProvider: false });
    render(<FirstRunExperience setup={setup} onSetupProviders={onSetupProviders} />);

    await user.click(screen.getByRole("button", { name: /set up free model/i }));

    expect(onSetupProviders).toHaveBeenCalledTimes(1);
    tauriFlag.value = false;
  });
});
