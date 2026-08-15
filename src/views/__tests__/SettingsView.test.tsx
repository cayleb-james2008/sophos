// SettingsView.test.tsx — the settings view wrapper. It composes a
// ViewScaffold header around the settings feature module.

import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../features/settings/SettingsView", () => ({
  SettingsView: () => <div data-testid="settings-feature">Settings feature body</div>,
}));

import { SettingsView } from "../SettingsView";

describe("SettingsView", () => {
  it("renders the settings scaffold header", () => {
    render(<SettingsView />);
    expect(screen.getByRole("heading", { name: "Settings" })).toBeInTheDocument();
    expect(screen.getByText(/Providers, models, preferences/i)).toBeInTheDocument();
  });

  it("renders the settings feature body inside the scaffold", () => {
    render(<SettingsView />);
    expect(screen.getByTestId("settings-feature")).toBeInTheDocument();
    expect(screen.getByText("Settings feature body")).toBeInTheDocument();
  });
});
