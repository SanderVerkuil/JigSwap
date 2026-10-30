// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { IntlProvider } from "use-intl";
import { afterEach, describe, expect, it } from "vitest";
import en from "../../../../locales/en.json";
import nl from "../../../../locales/nl.json";
import { RevealGuard } from "./reveal-guard";

afterEach(cleanup);

const renderGuard = (locale: "en" | "nl" = "en") =>
  render(
    <IntlProvider locale={locale} messages={locale === "en" ? en : nl}>
      <RevealGuard>
        <span>Flagged photo</span>
      </RevealGuard>
    </IntlProvider>,
  );

const revealButton = () =>
  screen.queryByRole("button", { name: "Click or tap to reveal the photo" });
const hideButton = () => screen.queryByRole("button", { name: "Hide again" });

describe("RevealGuard", () => {
  it("starts blurred and a pointer passing over it does not reveal it", () => {
    renderGuard();
    const guard = revealButton()!;
    expect(guard).not.toBeNull();
    fireEvent.pointerEnter(guard);
    fireEvent.mouseOver(guard);
    fireEvent.mouseEnter(guard);
    expect(revealButton()).not.toBeNull();
    expect(hideButton()).toBeNull();
    // Nothing in the guard reacts to :hover (the old guard used group-hover:opacity-0).
    expect(document.body.innerHTML).not.toContain("hover:opacity-0");
  });

  it("a click reveals the photo and moves focus to Hide again, which blurs it again", () => {
    renderGuard();
    fireEvent.click(revealButton()!);
    expect(revealButton()).toBeNull();
    const hide = hideButton()!;
    expect(document.activeElement).toBe(hide);

    fireEvent.click(hide);
    expect(hideButton()).toBeNull();
    expect(document.activeElement).toBe(revealButton());
  });

  it("the guard is a native button, so Enter and Space reveal it from the keyboard", () => {
    renderGuard();
    const guard = revealButton()!;
    expect(guard.tagName).toBe("BUTTON");
    expect(guard.getAttribute("type")).toBe("button");
    expect(guard.tabIndex).toBe(0);
  });

  it("speaks Dutch", () => {
    renderGuard("nl");
    fireEvent.click(
      screen.getByRole("button", {
        name: "Klik of tik om de foto te tonen",
      }),
    );
    expect(screen.getByRole("button", { name: "Weer verbergen" })).toBeTruthy();
  });
});
