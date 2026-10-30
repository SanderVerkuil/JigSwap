// @vitest-environment happy-dom
import {
  openCookieSettings,
  readAnalyticsConsent,
} from "@/lib/analytics-consent";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import type { ComponentProps } from "react";
import { renderToString } from "react-dom/server";
import { IntlProvider } from "use-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import en from "../../../locales/en.json";
import nl from "../../../locales/nl.json";
import { CookieConsent } from "./cookie-consent";

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    to,
    hash,
    children,
    ...rest
  }: ComponentProps<"a"> & { to: string; hash?: string }) => (
    <a href={hash ? `${to}#${hash}` : to} {...rest}>
      {children}
    </a>
  ),
}));

// A loaded PostHog stand-in; like the real client, reset() clears the stored
// opt-out, so only reset-then-opt-out leaves it opted out.
const posthog = vi.hoisted(() => {
  let optedOut = false;
  const stub = {
    loaded: false,
    client: {
      reset: () => {
        optedOut = false;
      },
      opt_out_capturing: () => {
        optedOut = true;
      },
      opt_in_capturing: () => {
        optedOut = false;
      },
      has_opted_out_capturing: () => optedOut,
    },
    // analytics-client's one shutdown path (its real calls are pinned in
    // lib/analytics-client.test.ts).
    withdraw: vi.fn(() => {
      if (stub.loaded) {
        stub.client.reset();
        stub.client.opt_out_capturing();
      }
      return Promise.resolve();
    }),
  };
  return stub;
});
vi.mock("@/lib/analytics-client", () => ({
  initPostHog: vi.fn(async () => {
    posthog.loaded = true;
    return posthog.client;
  }),
  getPostHog: () => (posthog.loaded ? posthog.client : null),
  withdrawAnalyticsConsent: posthog.withdraw,
}));

const setConsentCookie = (value: "true" | "false" | null) => {
  document.cookie =
    value === null
      ? "cookieConsent=; path=/; max-age=0"
      : `cookieConsent=${value}; path=/`;
};

const banner = (locale: "en" | "nl" = "en") => (
  <IntlProvider
    locale={locale}
    messages={locale === "nl" ? nl : en}
    timeZone="Europe/Amsterdam"
  >
    <button type="button" onClick={openCookieSettings}>
      Open settings
    </button>
    <CookieConsent variant="mini" />
  </IntlProvider>
);

const region = () => screen.queryByRole("region", { name: "Cookie settings" });

beforeEach(() => {
  setConsentCookie(null);
  posthog.loaded = false;
  posthog.client.opt_in_capturing();
  posthog.withdraw.mockClear();
});

afterEach(cleanup);

describe("CookieConsent (mini)", () => {
  it("is a labelled region whose choices are each announced once", () => {
    render(banner());

    expect(region()).toBeTruthy();
    // No hidden duplicate labels ("No thanksNo thanks").
    expect(screen.getAllByRole("button", { name: "No thanks" })).toHaveLength(
      1,
    );
    expect(
      screen.getAllByRole("button", { name: "Allow analytics" }),
    ).toHaveLength(1);
  });

  it("names PostHog and links to the cookie section of the privacy policy", () => {
    render(banner());

    expect(region()?.textContent).toContain("PostHog");
    const link = screen.getByRole("link", { name: "cookie policy" });
    expect(link.getAttribute("href")).toBe("/privacy#p-cookies");
  });

  it("speaks Dutch to Dutch visitors", () => {
    render(banner("nl"));

    expect(
      screen.getByRole("region", { name: "Cookie-instellingen" }),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Nee, bedankt" })).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Analyse toestaan" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("link", { name: "cookiebeleid" }).getAttribute("href"),
    ).toBe("/privacy#p-cookies");
  });

  it("is not rendered on the server, so a visitor who already chose never sees it flash", () => {
    expect(renderToString(banner())).not.toContain("Allow analytics");
  });

  it("starts analytics when allowed and then goes away", async () => {
    render(banner());

    fireEvent.click(screen.getByRole("button", { name: "Allow analytics" }));

    expect(readAnalyticsConsent(document.cookie)).toBe("granted");
    expect(region()).toBeNull();
    await vi.waitFor(() => expect(posthog.loaded).toBe(true));
  });

  it("stays hidden for a visitor who already chose, until Cookie settings reopens it", () => {
    setConsentCookie("false");
    render(banner());
    expect(region()).toBeNull();

    act(() => openCookieSettings());

    expect(region()).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "No thanks" }));
    expect(region()).toBeNull();
  });

  it("withdraws analytics consent when the visitor declines", () => {
    const onDecline = vi.fn();
    render(
      <IntlProvider locale="en" messages={en} timeZone="Europe/Amsterdam">
        <CookieConsent variant="mini" onDeclineCallback={onDecline} />
      </IntlProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "No thanks" }));

    expect(posthog.withdraw).toHaveBeenCalledTimes(1);
    expect(onDecline).toHaveBeenCalledTimes(1);
  });

  it("withdraws an earlier grant: PostHog is reset and opted out", () => {
    setConsentCookie("true");
    posthog.loaded = true;
    render(banner());

    act(() => openCookieSettings());
    fireEvent.click(screen.getByRole("button", { name: "No thanks" }));

    expect(readAnalyticsConsent(document.cookie)).toBe("denied");
    expect(posthog.client.has_opted_out_capturing()).toBe(true);
    expect(region()).toBeNull();
  });

  it("moves focus into the reopened banner and back to Cookie settings afterwards", () => {
    setConsentCookie("true");
    render(banner());
    const opener = screen.getByRole("button", { name: "Open settings" });
    act(() => opener.focus());

    fireEvent.click(opener);

    expect(document.activeElement).toBe(region());
    fireEvent.click(screen.getByRole("button", { name: "Allow analytics" }));
    expect(region()).toBeNull();
    expect(document.activeElement).toBe(opener);
  });
});
