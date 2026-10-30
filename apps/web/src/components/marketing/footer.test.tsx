// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { IntlProvider } from "use-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import en from "../../../locales/en.json";
import nl from "../../../locales/nl.json";
import { MarketingFooter } from "./footer";

const consent = vi.hoisted(() => ({ openCookieSettings: vi.fn() }));
vi.mock("@/lib/analytics-consent", () => consent);

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
