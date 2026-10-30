// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { IntlProvider } from "use-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import en from "../../../locales/en.json";
import { CookieConsent } from "./cookie-consent";

const withdrawAnalyticsConsent = vi.hoisted(() =>
  vi.fn(() => Promise.resolve()),
);
vi.mock("@/lib/analytics-client", () => ({ withdrawAnalyticsConsent }));

afterEach(() => {
  cleanup();
  withdrawAnalyticsConsent.mockClear();
});

describe("CookieConsent", () => {
  it("withdraws analytics consent when the visitor declines", () => {
    const onDecline = vi.fn();
    render(
      <IntlProvider locale="en" messages={en} timeZone="Europe/Amsterdam">
        <CookieConsent variant="mini" onDeclineCallback={onDecline} />
      </IntlProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: /Decline/ }));

    expect(withdrawAnalyticsConsent).toHaveBeenCalledTimes(1);
    expect(onDecline).toHaveBeenCalledTimes(1);
  });
});
