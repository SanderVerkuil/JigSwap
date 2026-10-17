import { describe, expect, it } from "vitest";
import {
  EMPTY_TIP_STATE,
  installMethod,
  iosCanAddToHomeScreen,
  isIOS,
  isStandalone,
  MIN_VISITS,
  neverShow,
  parseTipState,
  recordVisit,
  shouldAutoShow,
  snooze,
  SNOOZE_MS,
  type TipState,
} from "./logic";

const UA = {
  iphoneSafari:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1",
  iphoneChrome174:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/123.0.6312.52 Mobile/15E148 Safari/604.1",
  iphoneChrome163:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 16_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/110.0.5481.83 Mobile/15E148 Safari/604.1",
  iphoneEdge:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 16_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 EdgiOS/112.0.1722.46 Mobile/15E148 Safari/605.1.15",
  iphoneFirefox:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/124.0 Mobile/15E148 Safari/605.1.15",
  iphoneInstagram:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 324.0.4.26.52",
  iphoneWebView:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148",
  ipadDesktopSafari:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15",
  androidChrome:
    "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36",
  androidFirefox:
    "Mozilla/5.0 (Android 14; Mobile; rv:125.0) Gecko/125.0 Firefox/125.0",
};

const phone = (userAgent: string) => ({ userAgent, maxTouchPoints: 5 });

describe("isIOS", () => {
  it("recognises iPhone and iPadOS (Mac UA + touch), not a real Mac", () => {
    expect(isIOS(phone(UA.iphoneSafari))).toBe(true);
    expect(isIOS(phone(UA.ipadDesktopSafari))).toBe(true);
    expect(isIOS({ userAgent: UA.ipadDesktopSafari, maxTouchPoints: 0 })).toBe(
      false,
    );
    expect(isIOS(phone(UA.androidChrome))).toBe(false);
  });
});

describe("iosCanAddToHomeScreen", () => {
  it("allows Safari on iPhone and iPad", () => {
    expect(iosCanAddToHomeScreen(phone(UA.iphoneSafari))).toBe(true);
    expect(iosCanAddToHomeScreen(phone(UA.ipadDesktopSafari))).toBe(true);
  });

  it("allows Chrome and Edge on iOS 16.4+ only", () => {
    expect(iosCanAddToHomeScreen(phone(UA.iphoneChrome174))).toBe(true);
    expect(iosCanAddToHomeScreen(phone(UA.iphoneEdge))).toBe(true);
    expect(iosCanAddToHomeScreen(phone(UA.iphoneChrome163))).toBe(false);
  });

  it("refuses Firefox, in-app browsers and bare web views", () => {
    expect(iosCanAddToHomeScreen(phone(UA.iphoneFirefox))).toBe(false);
    expect(iosCanAddToHomeScreen(phone(UA.iphoneInstagram))).toBe(false);
    expect(iosCanAddToHomeScreen(phone(UA.iphoneWebView))).toBe(false);
  });

  it("is false off iOS", () => {
    expect(iosCanAddToHomeScreen(phone(UA.androidChrome))).toBe(false);
  });
});

describe("installMethod", () => {
  it("prefers a captured install prompt", () => {
    expect(
      installMethod({ traits: phone(UA.androidChrome), hasPrompt: true }),
    ).toBe("prompt");
  });

  it("falls back to the iOS Share steps", () => {
    expect(
      installMethod({ traits: phone(UA.iphoneSafari), hasPrompt: false }),
    ).toBe("ios");
  });

  it("offers nothing without a prompt or an iOS path", () => {
    expect(
      installMethod({ traits: phone(UA.androidChrome), hasPrompt: false }),
    ).toBeNull();
    expect(
      installMethod({ traits: phone(UA.androidFirefox), hasPrompt: false }),
    ).toBeNull();
  });
});

describe("isStandalone", () => {
  it("is true for display-mode standalone or iOS navigator.standalone", () => {
    expect(
      isStandalone({
        displayModeStandalone: true,
        navigatorStandalone: undefined,
      }),
    ).toBe(true);
    expect(
      isStandalone({ displayModeStandalone: false, navigatorStandalone: true }),
    ).toBe(true);
    expect(
      isStandalone({
        displayModeStandalone: false,
        navigatorStandalone: false,
      }),
    ).toBe(false);
  });
});

describe("tip state", () => {
  it("parses tolerantly", () => {
    expect(parseTipState(null)).toEqual(EMPTY_TIP_STATE);
    expect(parseTipState("not json")).toEqual(EMPTY_TIP_STATE);
    expect(parseTipState("[]")).toEqual(EMPTY_TIP_STATE);
    expect(parseTipState('{"visits":"3","never":"yes"}')).toEqual(
      EMPTY_TIP_STATE,
    );
    expect(
      parseTipState('{"visits":2.7,"snoozedUntil":100,"never":true}'),
    ).toEqual({ visits: 2, snoozedUntil: 100, never: true });
  });

  it("round-trips through JSON", () => {
    const state = neverShow(snooze(recordVisit(EMPTY_TIP_STATE), 1000));
    expect(parseTipState(JSON.stringify(state))).toEqual(state);
  });

  it("snoozes for 30 days", () => {
    expect(snooze(EMPTY_TIP_STATE, 1000).snoozedUntil).toBe(1000 + SNOOZE_MS);
    expect(SNOOZE_MS).toBe(30 * 24 * 60 * 60 * 1000);
  });
});

describe("shouldAutoShow", () => {
  const now = 1_000_000;
  const seasoned: TipState = { ...EMPTY_TIP_STATE, visits: MIN_VISITS };
  const base = {
    method: "ios" as const,
    standalone: false,
    mobile: true,
    state: seasoned,
    now,
    busy: false,
  };

  it("shows from the second session on", () => {
    expect(shouldAutoShow(base)).toBe(true);
    expect(shouldAutoShow({ ...base, state: { ...seasoned, visits: 1 } })).toBe(
      false,
    );
  });

  it("never shows when installed, on desktop, unsupported or busy", () => {
    expect(shouldAutoShow({ ...base, standalone: true })).toBe(false);
    expect(shouldAutoShow({ ...base, mobile: false })).toBe(false);
    expect(shouldAutoShow({ ...base, method: null })).toBe(false);
    expect(shouldAutoShow({ ...base, busy: true })).toBe(false);
  });

  it("respects the snooze window and never-again", () => {
    const snoozed = snooze(seasoned, now);
    expect(shouldAutoShow({ ...base, state: snoozed })).toBe(false);
    expect(
      shouldAutoShow({ ...base, state: snoozed, now: now + SNOOZE_MS }),
    ).toBe(true);
    expect(shouldAutoShow({ ...base, state: neverShow(seasoned) })).toBe(false);
  });
});
