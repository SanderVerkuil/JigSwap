import { describe, expect, it } from "vitest";
import { readAnalyticsConsent } from "./analytics-consent";

describe("readAnalyticsConsent", () => {
  it("is unset when there is no cookie string", () => {
    expect(readAnalyticsConsent(undefined)).toBe("unset");
    expect(readAnalyticsConsent(null)).toBe("unset");
    expect(readAnalyticsConsent("")).toBe("unset");
  });

  it("is unset when the consent cookie is absent", () => {
    expect(readAnalyticsConsent("jigswap-intl=nl; theme=dark")).toBe("unset");
  });

  it("reads an accepted notice as granted", () => {
    expect(readAnalyticsConsent("cookieConsent=true")).toBe("granted");
    expect(
      readAnalyticsConsent("jigswap-intl=nl; cookieConsent=true; theme=dark"),
    ).toBe("granted");
  });

  it("reads a declined notice as denied", () => {
    expect(readAnalyticsConsent("cookieConsent=false")).toBe("denied");
    expect(readAnalyticsConsent("a=1;  cookieConsent=false ")).toBe("denied");
  });

  it("does not match cookies whose name merely contains the consent name", () => {
    expect(readAnalyticsConsent("xcookieConsent=true")).toBe("unset");
  });

  it("treats malformed values as unset (analytics stays off)", () => {
    expect(readAnalyticsConsent("cookieConsent=")).toBe("unset");
    expect(readAnalyticsConsent("cookieConsent=yes")).toBe("unset");
  });
});
