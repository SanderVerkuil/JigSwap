// @vitest-environment happy-dom
// UX-57: the public header's language pill shows an SVG flag with the language code (an emoji
// flag renders as the letters "US" on Windows), is named with the current language and the visible
// code (WCAG 2.5.3), and its menu marks the current language as a checked radio with each name
// tagged in its own language.
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { IntlProvider } from "use-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import en from "../../../locales/en.json";
import nl from "../../../locales/nl.json";
import { MarketingHeader } from "./header";

vi.mock("@/compat/link", () => ({
  Link: ({ href, children }: { href: string; children?: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock("@/components/marketing/wordmark", () => ({ Wordmark: () => null }));
vi.mock("convex/react", () => ({
  Authenticated: () => null,
  Unauthenticated: () => null,
}));
vi.mock("@tanstack/react-router", () => ({
  useLocation: () => ({ pathname: "/" }),
  useRouter: () => ({ invalidate: vi.fn() }),
}));
vi.mock("@/lib/i18n", () => ({
  setLocale: vi.fn(),
  clearIntlCache: vi.fn(),
}));

afterEach(cleanup);

const renderHeader = (locale: "en" | "nl" = "en") =>
  render(
    <IntlProvider
      locale={locale}
      messages={locale === "nl" ? nl : en}
      timeZone="Europe/Amsterdam"
    >
      <MarketingHeader />
    </IntlProvider>,
  );

describe("MarketingHeader language pill", () => {
  it("shows the SVG flag and code of the current language, no emoji", () => {
    renderHeader("nl");
    const trigger = screen.getByRole("button", {
      name: "Taal wijzigen: Nederlands, NL",
    });
    expect(trigger.textContent).toBe("NL");
    expect(trigger.querySelector("svg[viewBox='0 0 60 45']")).toBeTruthy();
    expect(trigger.textContent).not.toMatch(/\p{Regional_Indicator}/u);
  });

  it("checks the current language and tags each name with its language", async () => {
    renderHeader();
    fireEvent.pointerDown(
      screen.getByRole("button", { name: "Switch language: English, EN" }),
      { button: 0, ctrlKey: false },
    );
    const items = await screen.findAllByRole("menuitemradio");
    expect(
      items.map((item) => [
        item.textContent,
        item.getAttribute("aria-checked"),
        item.getAttribute("lang"),
      ]),
    ).toEqual([
      ["English", "true", "en"],
      ["Nederlands", "false", "nl"],
    ]);
  });
});
