// Pure rules for the "Add JigSwap to your home screen" tip: which install path this browser has,
// whether the site already runs installed, and when the tip may show itself. Framework-free so the
// rules are unit-tested without a DOM; the hook in ./use-install-app.ts feeds them browser values.

/**
 * How this browser can install the site, or null when it can't (or we can't explain how).
 * - "prompt": Chromium fired `beforeinstallprompt`, so an "Install app" button can call prompt().
 * - "ios": iOS Safari, or iOS Chrome/Edge on iOS 16.4+, which add to the home screen via Share.
 * - "android-menu": Chrome on Android without a captured prompt. Chrome fires the event only when
 *   its own heuristics allow (engagement, no recent dismissal, once per page load), but its ⋮ menu
 *   can install the site at any time.
 */
export type InstallMethod = "prompt" | "ios" | "android-menu";

export interface BrowserTraits {
  userAgent: string;
  /** navigator.maxTouchPoints: tells iPadOS (which reports a Mac UA) apart from a real Mac. */
  maxTouchPoints: number;
}

// In-app browsers (Facebook, Instagram, LinkedIn, …) on iOS wrap WKWebView without a Share →
// "Add to Home Screen" action, so steps would point at a menu that isn't there.
const IOS_IN_APP =
  /FBAN|FBAV|Instagram|LinkedInApp|Line\/|GSA\/|Snapchat|Twitter/i;

/** The iOS major/minor version from a UA ("OS 17_4" → [17, 4]), or null when not iOS-shaped. */
export function iosVersion(userAgent: string): [number, number] | null {
  const match = userAgent.match(/OS (\d+)_(\d+)/);
  return match ? [Number(match[1]), Number(match[2])] : null;
}

export function isIOS({ userAgent, maxTouchPoints }: BrowserTraits): boolean {
  if (/iPhone|iPad|iPod/.test(userAgent)) return true;
  // iPadOS 13+ asks for the desktop site with a Macintosh UA; only touch gives it away.
  return /Macintosh/.test(userAgent) && maxTouchPoints > 1;
}

/** Whether this iOS browser offers Share → "Add to Home Screen". */
export function iosCanAddToHomeScreen(traits: BrowserTraits): boolean {
  if (!isIOS(traits)) return false;
  const ua = traits.userAgent;
  if (IOS_IN_APP.test(ua)) return false;
  // Chrome (CriOS) and Edge (EdgiOS) gained the action in iOS 16.4.
  if (/CriOS|EdgiOS/.test(ua)) {
    const version = iosVersion(ua);
    return (
      version !== null &&
      (version[0] > 16 || (version[0] === 16 && version[1] >= 4))
    );
  }
  // Other third-party iOS browsers (Firefox, DuckDuckGo, …): no documented path, so no tip.
  if (/FxiOS|OPiOS|DuckDuckGo|YaBrowser/.test(ua)) return false;
  // In-app WKWebViews generally omit the "Safari/" token; real Safari always carries it.
  return /Safari\//.test(ua);
}

/** Chrome itself on Android: not an app's WebView ("; wv)") or another Chromium browser. */
export function isAndroidChrome({ userAgent }: BrowserTraits): boolean {
  if (!/Android/.test(userAgent) || !/Chrome\/\d/.test(userAgent)) return false;
  if (/; wv\)/.test(userAgent)) return false;
  return !/SamsungBrowser|EdgA|OPR\/|YaBrowser|UCBrowser|DuckDuckGo|Firefox/.test(
    userAgent,
  );
}

/**
 * The install path to offer, or null: a captured prompt wins, then iOS's Share steps, then
 * Chrome's menu on Android. `installed` is navigator.getInstalledRelatedApps()'s answer (null
 * while unknown): the menu steps only show once JigSwap is known not to be installed already.
 */
export function installMethod({
  traits,
  hasPrompt,
  installed,
}: {
  traits: BrowserTraits;
  hasPrompt: boolean;
  installed: boolean | null;
}): InstallMethod | null {
  if (hasPrompt) return "prompt";
  if (iosCanAddToHomeScreen(traits)) return "ios";
  if (installed === false && isAndroidChrome(traits)) return "android-menu";
  return null;
}

/** Already launched from the home screen (any browser that reports it). */
export function isStandalone({
  displayModeStandalone,
  navigatorStandalone,
}: {
  displayModeStandalone: boolean;
  navigatorStandalone: boolean | undefined;
}): boolean {
  return displayModeStandalone || navigatorStandalone === true;
}

// ---- Per-device tip state (localStorage, one JSON value) --------------------------------------

export interface TipState {
  /** Browser sessions in the signed-in shell on this device, counted once per session. */
  visits: number;
  /** "Not now": hidden until this epoch-ms. */
  snoozedUntil: number | null;
  /** "Don't show again": the automatic tip never returns (the quick sheet entry still works). */
  never: boolean;
}

export const EMPTY_TIP_STATE: TipState = {
  visits: 0,
  snoozedUntil: null,
  never: false,
};

export const SNOOZE_MS = 30 * 24 * 60 * 60 * 1000;

/** The tip first shows on the member's second session on this device, never the first. */
export const MIN_VISITS = 2;

/** Tolerant parse: anything malformed falls back to the empty state, field by field. */
export function parseTipState(raw: string | null): TipState {
  if (!raw) return EMPTY_TIP_STATE;
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== "object" || value === null) return EMPTY_TIP_STATE;
    const v = value as Record<string, unknown>;
    return {
      visits:
        typeof v.visits === "number" &&
        Number.isFinite(v.visits) &&
        v.visits > 0
          ? Math.floor(v.visits)
          : 0,
      snoozedUntil:
        typeof v.snoozedUntil === "number" && Number.isFinite(v.snoozedUntil)
          ? v.snoozedUntil
          : null,
      never: v.never === true,
    };
  } catch {
    return EMPTY_TIP_STATE;
  }
}

export function recordVisit(state: TipState): TipState {
  return { ...state, visits: state.visits + 1 };
}

export function snooze(state: TipState, now: number): TipState {
  return { ...state, snoozedUntil: now + SNOOZE_MS };
}

export function neverShow(state: TipState): TipState {
  return { ...state, never: true };
}

/**
 * Whether the tip may show itself now. `busy` covers the shell's surface-busy store, an open
 * dialog, and a focused text field (the on-screen keyboard is up).
 */
export function shouldAutoShow({
  method,
  standalone,
  mobile,
  state,
  now,
  busy,
}: {
  method: InstallMethod | null;
  standalone: boolean;
  mobile: boolean;
  state: TipState;
  now: number;
  busy: boolean;
}): boolean {
  if (!method || standalone || !mobile || busy) return false;
  if (state.never) return false;
  if (state.snoozedUntil !== null && now < state.snoozedUntil) return false;
  return state.visits >= MIN_VISITS;
}
