// ContextRing.test.tsx — the SVG context-window ring. Pure presentational, so
// these tests drive the tokens/window/messages/size props and assert the
// accessible label, the rendered percentage, the token readout, and the
// danger styling that kicks in past 80%.

import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ContextRing } from "../ContextRing";

describe("ContextRing", () => {
  it("renders 0% when no tokens or window are supplied", () => {
    const { getByRole, getByText } = render(<ContextRing />);
    expect(getByRole("img")).toHaveAttribute("aria-label", "Context window 0% used");
    expect(getByText("0%")).toBeInTheDocument();
    expect(getByText("—")).toBeInTheDocument();
  });

  it("shows the computed percentage, token readout, and message count", () => {
    const { getByRole, getByText } = render(<ContextRing tokens={2500} contextWindow={10000} messages={7} />);
    expect(getByRole("img")).toHaveAttribute("aria-label", "Context window 25% used");
    expect(getByText("25%")).toBeInTheDocument();
    expect(getByText("2.5k")).toBeInTheDocument();
    expect(getByText("7")).toBeInTheDocument();
  });

  it("caps the displayed percentage at 100", () => {
    const { getByRole, getByText } = render(<ContextRing tokens={20000} contextWindow={10000} />);
    expect(getByRole("img")).toHaveAttribute("aria-label", "Context window 100% used");
    expect(getByText("100%")).toBeInTheDocument();
  });

  it("applies danger styling only above 80%", () => {
    const { container } = render(<ContextRing tokens={9000} contextWindow={10000} />);
    expect(container.querySelector(".ctx-ring__fill--danger")).not.toBeNull();
    expect(container.querySelector(".ctx-ring__pct--danger")).not.toBeNull();
  });

  it("stays non-danger at exactly 80%", () => {
    const { container } = render(<ContextRing tokens={8000} contextWindow={10000} />);
    expect(container.querySelector(".ctx-ring__fill--danger")).toBeNull();
    expect(container.querySelector(".ctx-ring__pct--danger")).toBeNull();
  });

  it("does not render a message count when messages is omitted", () => {
    const { queryByText } = render(<ContextRing tokens={100} contextWindow={1000} />);
    expect(queryByText("0")).toBeNull();
  });

  it("honours the size prop for the svg dimensions and ring geometry", () => {
    const { container } = render(<ContextRing size={96} />);
    expect(container.querySelector("svg")).toHaveAttribute("width", "96");
    expect(container.querySelector("svg")).toHaveAttribute("height", "96");
  });

  it("exposes the raw token/window in the title attribute", () => {
    const { container } = render(<ContextRing tokens={1234} contextWindow={5000} />);
    expect(container.querySelector("[title]")).toHaveAttribute("title", "1234 of 5000 tokens");
  });
});
