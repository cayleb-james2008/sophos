// AboutPanel.test.tsx — AboutPanel renders the app name, the live version read
// from package.json, the Beta badge, and the GitLab / CHANGELOG links.

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AboutPanel } from "../AboutPanel";
import { version } from "../../../../package.json";

describe("AboutPanel", () => {
  it("renders the app name, version, and Beta badge", () => {
    render(<AboutPanel />);
    expect(screen.getByText("Sophos")).toBeInTheDocument();
    expect(screen.getByText(`v${version}`)).toBeInTheDocument();
    expect(screen.getByText("Beta")).toBeInTheDocument();
  });

  it("renders a beta-disclaimer body copy", () => {
    render(<AboutPanel />);
    expect(screen.getByText(/All versions before v1\.0 are beta releases/i)).toBeInTheDocument();
  });

  it("links out to GitLab and the CHANGELOG with the right hrefs", () => {
    render(<AboutPanel />);
    const gitlab = screen.getByRole("link", { name: "GitLab" });
    expect(gitlab).toHaveAttribute("href", "https://gitlab.com/caylebalvarez-james/sophos");
    expect(gitlab).toHaveAttribute("target", "_blank");

    const changelog = screen.getByRole("link", { name: "Changelog" });
    expect(changelog.getAttribute("href")).toContain("gitlab.com/caylebalvarez-james/sophos");
    expect(changelog.getAttribute("href")).toContain("CHANGELOG.md");
  });
});
