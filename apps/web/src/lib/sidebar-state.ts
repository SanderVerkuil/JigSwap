import { createIsomorphicFn } from "@tanstack/react-start";
import { getCookie } from "@tanstack/react-start/server";

// The desktop sidebar's open state (UX-05). From 1024px a choice the member made
// with the toggle is remembered in `sidebar_state` (written by the sidebar
// primitive) and wins, and without one the sidebar is docked open. Below 1024px
// it always rests as the icon rail, so an 820px tablet keeps a ~700px content
// card instead of losing a third of its width to the sidebar; there the toggle
// opens the labelled sidebar over the page, which is never docked or remembered.
//
// The width is only known in the browser, so the shell also remembers which
// side of 1024px the window was on last time (`sidebar_wide`). SSR reads both
// cookies, so a returning visitor's first paint already has the right sidebar
// and nothing flashes from expanded to rail on load.

export const SIDEBAR_COOKIE_NAME = "sidebar_state";
export const SIDEBAR_WIDE_COOKIE_NAME = "sidebar_wide";
export const SIDEBAR_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;
// Below this the sidebar rests as the icon rail. Not P-32's 1280px: a 1024-1279px
// laptop keeps the docked sidebar it has today.
export const SIDEBAR_WIDE_QUERY = "(min-width: 1024px)";

export type SidebarCookies = {
  /** The member's own choice; undefined until they toggle the sidebar. */
  open: boolean | undefined;
  /** Whether the window was at least 1024px wide on the last visit. */
  wide: boolean | undefined;
};

export function parseSidebarCookie(
  value: string | null | undefined,
): boolean | undefined {
  if (value === "true") return true;
  if (value === "false") return false;
  return undefined;
}

function cookieValue(cookieString: string, name: string): string | undefined {
  for (const part of cookieString.split(";")) {
    const [key, ...rest] = part.split("=");
    if (key?.trim() === name) return rest.join("=").trim();
  }
  return undefined;
}

// Pure, for the browser read and its tests: a `document.cookie`-style string.
export function parseSidebarCookies(cookieString: string): SidebarCookies {
  return {
    open: parseSidebarCookie(cookieValue(cookieString, SIDEBAR_COOKIE_NAME)),
    wide: parseSidebarCookie(
      cookieValue(cookieString, SIDEBAR_WIDE_COOKIE_NAME),
    ),
  };
}

export function resolveSidebarOpen(
  explicit: boolean | undefined,
  wide: boolean,
): boolean {
  return wide && (explicit ?? true);
}

// For route beforeLoad: the request cookies during SSR, document.cookie in the
// browser (client-side navigations), so both render the same sidebar.
export const readSidebarCookies = createIsomorphicFn()
  .server((): SidebarCookies => ({
    open: parseSidebarCookie(getCookie(SIDEBAR_COOKIE_NAME)),
    wide: parseSidebarCookie(getCookie(SIDEBAR_WIDE_COOKIE_NAME)),
  }))
  .client((): SidebarCookies => parseSidebarCookies(document.cookie));

export function writeSidebarCookie(name: string, value: boolean) {
  document.cookie = `${name}=${value}; path=/; max-age=${SIDEBAR_COOKIE_MAX_AGE}; samesite=lax`;
}
