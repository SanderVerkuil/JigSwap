// @vitest-environment happy-dom
import { readAnalyticsConsent } from "@/lib/analytics-consent";
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

// Fresh per test: the store remembers this tab's choice in module state.
let CookieConsent: typeof import("./cookie-consent").CookieConsent;
let openCookieSettings: typeof import("@/lib/analytics-consent").openCookieSettings;

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

beforeEach(async () => {
  setConsentCookie(null);
  posthog.loaded = false;
  posthog.client.opt_in_capturing();
  posthog.withdraw.mockClear();
  vi.resetModules();
  ({ CookieConsent } = await import("./cookie-consent"));
  ({ openCookieSettings } = await import("@/lib/analytics-consent"));
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

  // No layout here, so the fit was measured in a browser (Dutch at 320px). This guards what makes
  // it hold: the second button drops to its own line rather than running off the screen.
  it("lets its buttons wrap on a narrow phone", () => {
    render(banner("nl"));
    const actions = screen.getByRole("button", {
      name: "Analyse toestaan",
    }).parentElement;
    expect(actions?.className.split(/\s+/)).toContain("flex-wrap");
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

  it("lifts itself above the app's tab bar on phones", () => {
    render(banner());

    expect(region()?.className).toContain(
      "max-md:[body:has([data-mobile-tab-bar])_&]:bottom-[calc(var(--mobile-tab-bar-height,57px)+20px)]",
    );
  });

  it("goes away when the browser discards the cookie, instead of staying for the session", () => {
    const cookie = vi
      .spyOn(document, "cookie", "set")
      .mockImplementation(() => {});
    try {
      render(banner());

      fireEvent.click(screen.getByRole("button", { name: "No thanks" }));

      expect(readAnalyticsConsent(document.cookie)).toBe("unset");
      expect(region()).toBeNull();
    } finally {
      cookie.mockRestore();
    }
  });

  it.each([
    ["true", "en", "You currently allow analytics."],
    ["false", "en", "You currently don't allow analytics."],
    ["true", "nl", "Je staat analyse nu toe."],
    ["false", "nl", "Je staat analyse nu niet toe."],
  ] as const)(
    "says what the current choice is when reopened (cookie %s, %s)",
    (cookie, locale, line) => {
      setConsentCookie(cookie);
      render(banner(locale));

      act(() => openCookieSettings());

      expect(screen.getByText(line)).toBeTruthy();
    },
  );

  it("leaves the choice alone when the reopened banner is closed with its button", () => {
    setConsentCookie("true");
    render(banner());
    const opener = screen.getByRole("button", { name: "Open settings" });
    act(() => opener.focus());
    fireEvent.click(opener);

    fireEvent.click(
      screen.getByRole("button", { name: "Close cookie settings" }),
    );

    expect(region()).toBeNull();
    expect(readAnalyticsConsent(document.cookie)).toBe("granted");
    expect(document.activeElement).toBe(opener);
  });

  it("leaves the choice alone when the reopened banner is closed with Escape", () => {
    setConsentCookie("false");
    render(banner());
    const opener = screen.getByRole("button", { name: "Open settings" });
    act(() => opener.focus());
    fireEvent.click(opener);

    fireEvent.keyDown(document.body, { key: "Escape" });

    expect(region()).toBeNull();
    expect(readAnalyticsConsent(document.cookie)).toBe("denied");
    expect(document.activeElement).toBe(opener);
  });

  it("leaves Escape to a layer that already handled it", () => {
    setConsentCookie("false");
    render(banner());
    act(() => openCookieSettings());

    const consumed = new KeyboardEvent("keydown", {
      key: "Escape",
      bubbles: true,
      cancelable: true,
    });
    consumed.preventDefault();
    fireEvent(document.body, consumed);

    expect(region()).toBeTruthy();
  });

  it("can't be dismissed before the visitor has chosen", () => {
    render(banner());

    expect(
      screen.queryByRole("button", { name: "Close cookie settings" }),
    ).toBeNull();
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(region()).toBeTruthy();

    // "Cookie settings" before any choice is the same question.
    act(() => openCookieSettings());
    expect(
      screen.queryByRole("button", { name: "Close cookie settings" }),
    ).toBeNull();
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(region()).toBeTruthy();
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
