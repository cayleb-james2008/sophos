// ShellNoticeBar — transient steer / shell indicators above the composer.

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ShellNoticeBar } from "../ShellNoticeBar";

describe("ShellNoticeBar", () => {
  it("renders nothing when there is no notice", () => {
    const { container } = render(<ShellNoticeBar steered={null} shellNotice={null} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders a steered notice with the quoted text", () => {
    render(<ShellNoticeBar steered={{ text: "keep going", at: Date.now() }} shellNotice={null} />);
    expect(screen.getByText(/steered/i)).toBeInTheDocument();
    expect(screen.getByText("“keep going”")).toBeInTheDocument();
  });

  it("renders a visible shell notice with the command", () => {
    render(<ShellNoticeBar steered={null} shellNotice={{ command: "npm test", hidden: false }} />);
    expect(screen.getByText(/shell/i)).toBeInTheDocument();
    expect(screen.getByText("$ npm test")).toBeInTheDocument();
  });

  it("labels a hidden shell as hidden", () => {
    render(<ShellNoticeBar steered={null} shellNotice={{ command: "sudo rm", hidden: true }} />);
    expect(screen.getByText(/hidden shell/i)).toBeInTheDocument();
    expect(screen.getByText("$ sudo rm")).toBeInTheDocument();
  });

  it("renders both notices together", () => {
    render(
      <ShellNoticeBar
        steered={{ text: "onward", at: Date.now() }}
        shellNotice={{ command: "ls", hidden: false }}
      />,
    );
    expect(screen.getByText("“onward”")).toBeInTheDocument();
    expect(screen.getByText("$ ls")).toBeInTheDocument();
  });
});
