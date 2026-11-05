// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { IntlProvider } from "use-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import en from "../../../locales/en.json";
import nl from "../../../locales/nl.json";
import { DocsMobileBar } from "./docs-mobile-bar";

const renderBar = (locale: "en" | "nl") => {
  const onOpenNav = vi.fn();
  const onOpenSearch = vi.fn();
  render(
    <IntlProvider
      locale={locale}
      messages={locale === "nl" ? nl : en}
      timeZone="Europe/Amsterdam"
    >
      <DocsMobileBar onOpenNav={onOpenNav} onOpenSearch={onOpenSearch} />
    </IntlProvider>,
  );
  return { onOpenNav, onOpenSearch };
};

// Visible text only: what a sighted voice-control user reads on the button.
const visibleText = (el: Element) => {
  const clone = el.cloneNode(true) as Element;
  clone.querySelectorAll(".sr-only").forEach((n) => n.remove());
  return clone.textContent?.trim() ?? "";
};

afterEach(cleanup);

describe("DocsMobileBar", () => {
  it.each([
    ["en", "Docs"],
    ["nl", "Documentatie"],
  ] as const)(
    "names the navigation button after its visible label (%s)",
    (locale, label) => {
      const { onOpenNav } = renderBar(locale);
      // WCAG 2.5.3: the button showing the label has an accessible name that
      // starts with it, so no aria-label may replace it.
      const button = screen.getByRole("button", {
        name: (name, el) =>
          visibleText(el) === label && name.startsWith(`${label} (`),
      });
      expect(button.hasAttribute("aria-label")).toBe(false);
      fireEvent.click(button);
      expect(onOpenNav).toHaveBeenCalledOnce();
    },
  );

  it("keeps a named search button", () => {
    const { onOpenSearch } = renderBar("en");
    fireEvent.click(
      screen.getByRole("button", { name: "Search documentation" }),
    );
    expect(onOpenSearch).toHaveBeenCalledOnce();
  });

  it("gives both buttons a 44px tap target", () => {
    renderBar("en");
    for (const button of screen.getAllByRole("button")) {
      expect(button.className).toMatch(/\bh-11\b/);
      expect(button.className).toMatch(/\bmin-w-11\b/);
    }
  });
});
