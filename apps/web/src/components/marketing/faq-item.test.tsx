// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { FaqItem } from "./faq-item";

afterEach(cleanup);

const renderItem = () => {
  render(<FaqItem q="Is it free?" a="Yes, JigSwap is free." />);
  const toggle = screen.getByRole("button", { name: "Is it free?" });
  const answerId = toggle.getAttribute("aria-controls");
  const answer = answerId ? document.getElementById(answerId) : null;
  return { toggle, answer };
};

describe("FaqItem", () => {
  it("points the toggle at the answer it shows and hides", () => {
    const { toggle, answer } = renderItem();
    expect(answer).not.toBeNull();
    expect(answer?.textContent).toBe("Yes, JigSwap is free.");
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
  });

  it("keeps a collapsed answer out of reach of screen readers and the keyboard", () => {
    const { answer } = renderItem();
    expect(answer?.hasAttribute("inert")).toBe(true);
    expect(answer?.getAttribute("aria-hidden")).toBe("true");
  });

  it("exposes the answer once opened", () => {
    const { toggle, answer } = renderItem();
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(answer?.hasAttribute("inert")).toBe(false);
    expect(answer?.hasAttribute("aria-hidden")).toBe(false);
  });
});
