import { useTranslations } from "use-intl";

/** Id of the dashboard shell's <main>; the skip link moves focus there. */
export const MAIN_CONTENT_ID = "main-content";

/**
 * Focuses the page's main content: the shell's #main-content, else the first <main> (public pages
 * render their own), made script-focusable when it isn't already. Returns whether it found one.
 */
export function focusMainContent(options?: FocusOptions): boolean {
  const main =
    document.getElementById(MAIN_CONTENT_ID) ?? document.querySelector("main");
  if (!main) return false;
  if (!main.hasAttribute("tabindex")) main.setAttribute("tabindex", "-1");
  main.focus(options);
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
      // Focus directly instead of following the hash, which would add a history entry and
      // miss public pages whose <main> has no id. No scroll: the link is the first Tab stop, so
      // the content top is already in view, and scrolling <main> to the top edge would tuck it
      // under the sticky header.
      onClick={(event) => {
        if (focusMainContent({ preventScroll: true })) event.preventDefault();
      }}
      className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-100 focus:rounded-md focus:bg-background focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:text-foreground focus:shadow-md focus:ring-2 focus:ring-ring focus:outline-none"
    >
      {t("skipToContent")}
    </a>
  );
}
