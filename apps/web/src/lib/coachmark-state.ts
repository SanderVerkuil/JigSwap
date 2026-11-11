import { createIsomorphicFn } from "@tanstack/react-start";
import { getCookie } from "@tanstack/react-start/server";

// My Puzzles' one-time hint about the card's ⋯ menu is dismissed for good with its X. The
// dismissal lives in a cookie so the server knows it too: the hint is in the first paint or not
// at all, and never appears after hydration to push the list down. Dismissals from before the
// cookie were kept only in localStorage; the browser still honours those and copies them over.

export const COACHMARK_COOKIE_NAME = "puzzles_coachmark_dismissed";
export const COACHMARK_STORAGE_KEY = "jigswap.coachmark.myPuzzlesActions";
const COACHMARK_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

// Pure, for the browser read and its tests: a `document.cookie`-style string.
export function parseCoachmarkDismissed(cookieString: string): boolean {
  return cookieString
    .split(";")
    .some((part) => part.trim() === `${COACHMARK_COOKIE_NAME}=1`);
}

// What the first paint knows: the request cookie during SSR, document.cookie in the browser (on
// hydration), so both render the same page. With no request to read, the hint stays out of the
// HTML and the browser shows it after hydration if it was never dismissed.
export const readCoachmarkDismissed = createIsomorphicFn()
  .server((): boolean => {
    try {
      return getCookie(COACHMARK_COOKIE_NAME) === "1";
    } catch {
      return true;
    }
  })
  .client((): boolean => parseCoachmarkDismissed(document.cookie));

// A dismissal from before the cookie is in localStorage alone, which the server can't read, so
// that member's first My Puzzles after the cookie arrived still has the hint in its HTML. My
// Puzzles runs this in its head, before the browser parses the body: it marks the document, and
// the hint hides under the mark (`in-data-coachmark-dismissed:hidden`), so the first paint has no
// hint and hydration taking it out moves nothing. It leaves the cookie to the page: written before
// hydration, the browser's first render would differ from the server's.
export const COACHMARK_PREPAINT_SCRIPT = `try{if(localStorage.getItem(${JSON.stringify(COACHMARK_STORAGE_KEY)})==="1")document.documentElement.setAttribute("data-coachmark-dismissed","")}catch(e){}`;

// Scoped to My Puzzles, the one page that reads it, so it rides along with no other request.
export function writeCoachmarkDismissed() {
  document.cookie = `${COACHMARK_COOKIE_NAME}=1; path=/my-puzzles; max-age=${COACHMARK_COOKIE_MAX_AGE}; samesite=lax`;
}
