// @vitest-environment happy-dom
import { FOCUS } from "@/components/marketing/home/classes";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
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

const consent = vi.hoisted(() => ({ openCookieSettings: vi.fn() }));
vi.mock("@/lib/analytics-consent", () => consent);

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

  it("offers Cookie settings in its footer, which reopens the cookie banner", () => {
    renderShell();
    fireEvent.click(
      within(screen.getByRole("contentinfo")).getByRole("button", {
        name: "Cookie settings",
      }),
    );
    expect(consent.openCookieSettings).toHaveBeenCalledTimes(1);
  });

  // On the canal band the global ring measures 1.74:1; FOCUS outlines in the link's own ink.
  it("rings its footer links in their own ink on the canal band", () => {
    renderShell();
    const footer = screen.getByRole("contentinfo");
    const controls = [
      ...within(footer).getAllByRole("link"),
      within(footer).getByRole("button", { name: "Cookie settings" }),
    ];
    expect(controls).toHaveLength(4);
    for (const control of controls) {
      expect(control.className.split(/\s+/)).toEqual(
        expect.arrayContaining(FOCUS.split(" ")),
      );
    }
  });

  // The street's public edge (DESIGN.md Layout: 16px, 40px from 760px), as on the marketing header,
  // so the wordmark doesn't jump between /catalog and /sign-in.
  it("puts its header and footer row on the public 40px edge", () => {
    renderShell();
    const rows = [
      screen.getByRole("banner"),
      screen.getByRole("contentinfo").firstElementChild as HTMLElement,
    ];
    for (const row of rows) {
      const classes = row.className.split(/\s+/);
      expect(classes).toEqual(
        expect.arrayContaining(["w-full", "px-4", "min-[760px]:px-10"]),
      );
      expect(classes).not.toContain("mx-auto");
      expect(classes).not.toContain("max-w-[1200px]");
    }
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
