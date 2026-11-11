import { useTranslations } from "use-intl";

/** Id of the page's <main>, on every page: the skip link's target, with or without JS. */
export const MAIN_CONTENT_ID = "main-content";

/** The page's main content: #main-content, else the first <main>. */
export function mainContentElement(): HTMLElement | null {
  return (
    document.getElementById(MAIN_CONTENT_ID) ?? document.querySelector("main")
  );
}

/**
 * Focuses the page's main content (see mainContentElement), made script-focusable when it isn't
 * already. Returns whether it found one.
 */
export function focusMainContent(options?: FocusOptions): boolean {
  const main = mainContentElement();
  if (!main) return false;
  if (!main.hasAttribute("tabindex")) main.setAttribute("tabindex", "-1");
  main.focus(options);
  return true;
}

/**
 * Focuses what a URL hash (with or without its "#", encoded or not) points at in the main content,
 * as the browser does when it loads a page at a fragment: a FAQ question's <details> by its
 * <summary>, which can take focus already, anything else made script-focusable. Returns whether it
 * found one.
 */
export function focusHashTarget(hash: string, options?: FocusOptions): boolean {
  let id = hash.replace(/^#/, "");
  try {
    id = decodeURIComponent(id);
  } catch {
    // Not percent-encoded after all: look it up as it is.
  }
  const target = id ? document.getElementById(id) : null;
  if (!target || !mainContentElement()?.contains(target)) return false;
  const summary =
    target instanceof HTMLDetailsElement
      ? target.querySelector("summary")
      : null;
  const element = summary ?? target;
  if (!summary && !element.hasAttribute("tabindex")) {
    element.setAttribute("tabindex", "-1");
  }
  element.focus(options);
  return true;
}

/**
 * "Skip to content" bypass link (WCAG 2.4.1): hidden until focused, so it is the first Tab stop
 * and lets keyboard users jump past the header, sidebar and top-bar controls.
 */
export function SkipLink() {
  const t = useTranslations("common");
  return (
    <a
      href={`#${MAIN_CONTENT_ID}`}
      // With JS, focus directly instead of following the hash, which would add a history entry.
      // No scroll: the link is the first Tab stop, so the content top is already in view, and
      // scrolling <main> to the top edge would tuck it under the sticky header. Without JS (or
      // before hydration) the browser follows the hash to the same <main>.
      onClick={(event) => {
        if (focusMainContent({ preventScroll: true })) event.preventDefault();
      }}
      className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-100 focus:rounded-md focus:bg-background focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:text-foreground focus:shadow-md focus:ring-2 focus:ring-ring focus:outline-none"
    >
      {t("skipToContent")}
    </a>
  );
}
