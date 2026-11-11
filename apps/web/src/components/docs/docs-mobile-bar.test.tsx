// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { join } from "node:path";
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

  it("gives every control a 44px tap target", () => {
    renderBar("en");
    for (const control of [
      ...screen.getAllByRole("button"),
      screen.getByRole("link", { name: "On this page" }),
    ]) {
      expect(control.className).toMatch(/\bh-11\b/);
      expect(control.className).toMatch(/\bmin-w-11\b/);
    }
  });

  // F20: a long article's contents are otherwise only at its top on a phone.
  it.each([
    ["en", "On this page"],
    ["nl", "Op deze pagina"],
  ] as const)(
    "jumps back to the article's contents and opens them (%s)",
    (locale, label) => {
      const contents = document.createElement("details");
      contents.id = "on-this-page";
      document.body.append(contents);
      renderBar(locale);

      const link = screen.getByRole("link", { name: label });
      expect(link.getAttribute("href")).toBe("#on-this-page");
      fireEvent.click(link);
      expect(contents.open).toBe(true);
      contents.remove();
    },
  );

  it("hides the jump on pages without contents to jump to", () => {
    renderBar("en");
    expect(
      screen.getByRole("link", { name: "On this page" }).className,
    ).toContain("[body:not(:has(#on-this-page))_&]:hidden");
  });

  // F16: an anchored heading used to land half under the bar. The page's scroll-padding grows by the
  // bar's 48px wherever it shows (64px header + 48px bar), keyed to the bar's own marker.
  it("is cleared by the page's scroll-padding where it shows", () => {
    renderBar("en");
    const bar = document.querySelector("[data-docs-bar]");
    expect(bar?.className).toContain("max-[861px]:flex");
    const css = readFileSync(
      join(__dirname, "../../styles/docs.css"),
      "utf8",
    ).replace(/\/\*[\s\S]*?\*\//g, "");
    expect(css).toMatch(
      /@media \(width < 861px\) \{\s*html:has\(\.mk-root\):has\(\[data-docs-bar\]\) \{\s*scroll-padding-top: 112px;/,
    );
  });
});
