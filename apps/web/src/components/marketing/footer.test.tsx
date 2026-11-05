// @vitest-environment happy-dom
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
import { MarketingFooter } from "./footer";

const consent = vi.hoisted(() => ({ openCookieSettings: vi.fn() }));
vi.mock("@/lib/analytics-consent", () => consent);

const auth = vi.hoisted(() => ({ isAuthenticated: false }));
vi.mock("convex/react", () => ({ useConvexAuth: () => auth }));

vi.mock("@/compat/link", () => ({
  Link: ({ href, ...rest }: ComponentProps<"a"> & { href: string }) => (
    <a href={href} {...rest} />
  ),
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    to,
    hash,
    ...rest
  }: ComponentProps<"a"> & { to: string; hash?: string }) => (
    <a href={hash ? `${to}#${hash}` : to} {...rest} />
  ),
}));

const renderFooter = (locale: "en" | "nl" = "en") =>
  render(
    <IntlProvider
      locale={locale}
      messages={locale === "nl" ? nl : en}
      timeZone="Europe/Amsterdam"
    >
      <MarketingFooter />
    </IntlProvider>,
  );

afterEach(cleanup);

describe("MarketingFooter start link", () => {
  afterEach(() => {
    auth.isAuthenticated = false;
  });

  it("invites a visitor to start", () => {
    renderFooter();
    expect(
      screen.getByRole("link", { name: "Start trading" }).getAttribute("href"),
    ).toBe("/sign-up");
  });

  it("takes a member to their dashboard, under that name", () => {
    auth.isAuthenticated = true;
    renderFooter();
    expect(screen.queryByRole("link", { name: "Start trading" })).toBeNull();
    expect(
      screen.getByRole("link", { name: "Dashboard" }).getAttribute("href"),
    ).toBe("/dashboard");
  });
});

describe("MarketingFooter touch targets", () => {
  // No layout here, so the size was measured in a browser (34px at 390 and 820, same rhythm as
  // before). These classes are what make it: every link grows on touch while the gap shrinks.
  it("gives every link and the cookie button more height on touch screens", () => {
    renderFooter();
    const footer = screen.getByRole("contentinfo");
    const controls = [
      ...within(footer)
        .getAllByRole("link")
        .filter((link) => link.textContent),
      within(footer).getByRole("button", { name: "Cookie settings" }),
    ];
    // The brand link above the columns isn't a list item.
    const listed = controls.filter((el) => el.closest(".flex-col"));
    expect(listed.length).toBeGreaterThan(5);
    for (const el of listed) {
      expect(el.className.split(/\s+/)).toContain("pointer-coarse:py-1.5");
    }
  });
});

describe("MarketingFooter legal links", () => {
  it("points Cookie policy at the cookie section, not the top of the privacy policy", () => {
    renderFooter();
    expect(
      screen.getByRole("link", { name: "Cookie policy" }).getAttribute("href"),
    ).toBe("/privacy#p-cookies");
    expect(
      screen.getByRole("link", { name: "Privacy policy" }).getAttribute("href"),
    ).toBe("/privacy");
  });

  it("offers Cookie settings, which reopens the cookie banner", () => {
    renderFooter();
    fireEvent.click(screen.getByRole("button", { name: "Cookie settings" }));
    expect(consent.openCookieSettings).toHaveBeenCalledTimes(1);
  });

  it("names Cookie settings in Dutch", () => {
    renderFooter("nl");
    expect(
      screen.getByRole("button", { name: "Cookie-instellingen" }),
    ).toBeTruthy();
  });
});
