import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { SkillDistillationPanel } from "../SkillDistillationPanel";

describe("SkillDistillationPanel Component", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the header and discovery badges", async () => {
    render(<SkillDistillationPanel />);

    expect(
      screen.getByRole("heading", {
        name: /Self-Evolving Skill Distillation Engine/i,
      }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Voyager Engine: Active/i)).toBeInTheDocument();
  });

  it("renders distilled skills list and selects a skill package", async () => {
    render(<SkillDistillationPanel />);

    await waitFor(() => {
      expect(screen.getByTestId("skill-card-skill-act-remediator")).toBeInTheDocument();
      expect(screen.getByTestId("skill-card-skill-ipc-sync")).toBeInTheDocument();
    });

    const secondSkill = screen.getByTestId("skill-card-skill-ipc-sync");
    fireEvent.click(secondSkill);

    await waitFor(() => {
      expect(screen.getByTestId("skill-markdown-preview")).toBeInTheDocument();
    });
  });

  it("triggers distillation from trajectory input", async () => {
    render(<SkillDistillationPanel />);

    const sessionInput = screen.getByTestId("input-session-id");
    fireEvent.change(sessionInput, { target: { value: "session-auto-refactor" } });

    const distillBtn = screen.getByTestId("btn-distill-skill");
    fireEvent.click(distillBtn);

    await waitFor(() => {
      expect(screen.getByTestId("skill-status-banner")).toBeInTheDocument();
    });
  });

  it("promotes a draft skill package to canonical library", async () => {
    render(<SkillDistillationPanel />);

    await waitFor(() => {
      expect(screen.getByTestId("skill-card-skill-ipc-sync")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("skill-card-skill-ipc-sync"));

    const promoteBtn = screen.getByTestId("btn-promote-skill");
    fireEvent.click(promoteBtn);

    await waitFor(() => {
      expect(screen.getByTestId("skill-status-banner")).toHaveTextContent(/Promoted skill/i);
    });
  });
});
