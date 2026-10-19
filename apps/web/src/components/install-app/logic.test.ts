import { describe, expect, it } from "vitest";
import {
  EMPTY_TIP_STATE,
  installMethod,
  iosCanAddToHomeScreen,
  isAndroidChrome,
  isAndroidFirefox,
  isIOS,
  isIOSFirefox,
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
  iphoneFirefox163:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 16_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/110.0 Mobile/15E148 Safari/605.1.15",
  androidFirefoxTablet:
    "Mozilla/5.0 (Android 14; Tablet; rv:125.0) Gecko/125.0 Firefox/125.0",
  desktopFirefox:
    "Mozilla/5.0 (X11; Linux x86_64; rv:125.0) Gecko/20100101 Firefox/125.0",
  androidWebView:
    "Mozilla/5.0 (Linux; Android 14; Pixel 8 Build/AP1A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/124.0.0.0 Mobile Safari/537.36",
  androidSamsung:
    "Mozilla/5.0 (Linux; Android 14; SM-S921B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0.0.0 Mobile Safari/537.36",
  androidEdge:
    "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36 EdgA/124.0.2478.50",
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

describe("isAndroidChrome", () => {
  it("recognises Chrome on Android only", () => {
    expect(isAndroidChrome(phone(UA.androidChrome))).toBe(true);
    expect(isAndroidChrome(phone(UA.androidWebView))).toBe(false);
    expect(isAndroidChrome(phone(UA.androidSamsung))).toBe(false);
    expect(isAndroidChrome(phone(UA.androidEdge))).toBe(false);
    expect(isAndroidChrome(phone(UA.androidFirefox))).toBe(false);
    expect(isAndroidChrome(phone(UA.iphoneChrome174))).toBe(false);
  });
});

describe("isIOSFirefox", () => {
  it("recognises Firefox on iOS 16.4+ only", () => {
    expect(isIOSFirefox(phone(UA.iphoneFirefox))).toBe(true);
    expect(isIOSFirefox(phone(UA.iphoneFirefox163))).toBe(false);
    expect(isIOSFirefox(phone(UA.iphoneSafari))).toBe(false);
    expect(isIOSFirefox(phone(UA.androidFirefox))).toBe(false);
  });
});

describe("isAndroidFirefox", () => {
  it("recognises Firefox on Android phones and tablets only", () => {
    expect(isAndroidFirefox(phone(UA.androidFirefox))).toBe(true);
    expect(isAndroidFirefox(phone(UA.androidFirefoxTablet))).toBe(true);
    expect(isAndroidFirefox(phone(UA.desktopFirefox))).toBe(false);
    expect(isAndroidFirefox(phone(UA.androidChrome))).toBe(false);
    expect(isAndroidFirefox(phone(UA.iphoneFirefox))).toBe(false);
  });
});

describe("installMethod", () => {
  it("prefers a captured install prompt", () => {
    expect(
      installMethod({
        traits: phone(UA.androidChrome),
        hasPrompt: true,
        installed: null,
      }),
    ).toBe("prompt");
  });

  it("falls back to the iOS Share steps", () => {
    expect(
      installMethod({
        traits: phone(UA.iphoneSafari),
        hasPrompt: false,
        installed: null,
      }),
    ).toBe("ios");
  });

  it("falls back to Chrome's menu on Android once JigSwap is known not installed", () => {
    expect(
      installMethod({
        traits: phone(UA.androidChrome),
        hasPrompt: false,
        installed: false,
      }),
    ).toBe("android-menu");
  });

  it("offers no Android menu steps when installed or the install state is unknown", () => {
    for (const installed of [true, null]) {
      expect(
        installMethod({
          traits: phone(UA.androidChrome),
          hasPrompt: false,
          installed,
        }),
      ).toBeNull();
    }
  });

  it("gives Firefox on Android its menu steps, never a prompt button", () => {
    // Firefox never fires beforeinstallprompt, and can't say whether JigSwap is installed.
    for (const installed of [false, null]) {
      expect(
        installMethod({
          traits: phone(UA.androidFirefox),
          hasPrompt: false,
          installed,
        }),
      ).toBe("firefox-menu");
    }
    expect(
      installMethod({
        traits: phone(UA.androidFirefox),
        hasPrompt: false,
        installed: true,
      }),
    ).toBeNull();
  });

  it("gives Firefox on iOS 16.4+ its Share steps", () => {
    expect(
      installMethod({
        traits: phone(UA.iphoneFirefox),
        hasPrompt: false,
        installed: null,
      }),
    ).toBe("ios-firefox");
    expect(
      installMethod({
        traits: phone(UA.iphoneFirefox163),
        hasPrompt: false,
        installed: null,
      }),
    ).toBeNull();
  });

  it("offers nothing to other Android browsers without a prompt", () => {
    for (const ua of [UA.androidWebView, UA.androidSamsung]) {
      expect(
        installMethod({
          traits: phone(ua),
          hasPrompt: false,
          installed: false,
        }),
      ).toBeNull();
    }
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
