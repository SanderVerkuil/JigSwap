// @vitest-environment happy-dom
import { cleanup, render, screen, within } from "@testing-library/react";
import type { ComponentProps } from "react";
import { IntlProvider } from "use-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import en from "../../../locales/en.json";
import nl from "../../../locales/nl.json";
import { AuthShell } from "./auth-shell";

vi.mock("@/compat/link", () => ({
  Link: ({ href, ...rest }: ComponentProps<"a"> & { href: string }) => (
    <a href={href} {...rest} />
  ),
}));

vi.mock("next-themes", () => ({
  useTheme: () => ({ resolvedTheme: "light", setTheme: vi.fn() }),
}));

vi.mock("@tanstack/react-router", () => ({
  useLocation: () => ({ pathname: "/sign-in" }),
  useRouter: () => ({ invalidate: vi.fn() }),
}));

vi.mock("@/lib/i18n", () => ({
  clearIntlCache: vi.fn(),
  setLocale: vi.fn(),
}));

const renderShell = (locale: "en" | "nl" = "en") =>
  render(
    <IntlProvider
      locale={locale}
      messages={locale === "nl" ? nl : en}
      timeZone="Europe/Amsterdam"
    >
      <AuthShell>
        <div data-testid="clerk-card" />
      </AuthShell>
    </IntlProvider>,
  );

afterEach(cleanup);

describe("AuthShell", () => {
  it("puts the auth card inside the page's one main landmark", () => {
    renderShell();
    const mains = screen.getAllByRole("main");
    expect(mains).toHaveLength(1);
    expect(within(mains[0]).getByTestId("clerk-card")).toBeTruthy();
  });

  it("links the wordmark back to the home page", () => {
    renderShell();
    const banner = screen.getByRole("banner");
    expect(
      within(banner)
        .getByRole("link", { name: "JigSwap" })
        .getAttribute("href"),
    ).toBe("/");
  });

  it("offers the language and theme switches", () => {
    renderShell();
    const banner = screen.getByRole("banner");
    expect(
      within(banner).getByRole("button", {
        name: "Switch language: English, EN",
      }),
    ).toBeTruthy();
    expect(
      within(banner).getByRole("button", { name: "Toggle dark mode" }),
    ).toBeTruthy();
  });

  it("links to the privacy policy, terms and public catalogue in its footer", () => {
    renderShell();
    const footer = screen.getByRole("contentinfo");
    const href = (name: string) =>
      within(footer).getByRole("link", { name }).getAttribute("href");
    expect(href("Privacy policy")).toBe("/privacy");
    expect(href("Terms of service")).toBe("/terms");
    expect(href("Browse puzzles")).toBe("/catalog");
  });

  it("speaks the visitor's language", () => {
    renderShell("nl");
    const footer = screen.getByRole("contentinfo");
    expect(
      within(footer).getByRole("link", { name: "Privacybeleid" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Taal wijzigen: Nederlands, NL" }),
    ).toBeTruthy();
  });
});
