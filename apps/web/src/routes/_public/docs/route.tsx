import { MAIN_CONTENT_ID } from "@/components/a11y/skip-link";
import { DocsMobileBar } from "@/components/docs/docs-mobile-bar";
import { DocsSearch } from "@/components/docs/docs-search";
import { DocsSearchProvider } from "@/components/docs/docs-search-context";
import { DocsSidebar } from "@/components/docs/docs-sidebar";
import { useOverlayFocusReturn } from "@/components/docs/use-overlay-focus-return";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@/components/ui/sheet";
import { createFileRoute, Outlet, useLocation } from "@tanstack/react-router";
import * as React from "react";
import { useTranslations } from "use-intl";

export const Route = createFileRoute("/_public/docs")({
  component: DocsLayout,
});

function DocsLayout() {
  const t = useTranslations("marketing.docs");
  const [searchOpen, setSearchOpen] = React.useState(false);
  const [navOpen, setNavOpen] = React.useState(false);
  const openSearch = React.useCallback(() => setSearchOpen(true), []);
  const overlayFocus = useOverlayFocusReturn();

  // The /docs landing page renders a full-bleed marketing hero, which looks
  // cramped inside the 280px sidebar grid. Detect the exact index route via the
  // current pathname (trailing slash tolerant) and drop the sidebar column for
  // it; every nested doc page keeps the sidebar + TOC layout. The mobile bar,
  // search dialog, and ⌘K handler stay mounted on all docs routes regardless.
  const { pathname } = useLocation();
  const isIndex = pathname.replace(/\/$/, "") === "/docs";

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearchOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <DocsSearchProvider value={openSearch}>
      <DocsMobileBar
        onOpenNav={() => setNavOpen(true)}
        onOpenSearch={() => setSearchOpen(true)}
      />
      {isIndex ? (
        // Full-width landing: no sidebar, no horizontal padding/max-width so the
        // PageHero band can bleed edge-to-edge. The page supplies its own
        // Container for the card grid.
        <main id={MAIN_CONTENT_ID} className="min-w-0">
          <Outlet />
        </main>
      ) : (
        // The sidebar collapses (and DocsMobileBar takes over) below 861px, where
        // the content column would get too narrow. The marketing header's nav has
        // folded into its burger by then (below 1200px), so the Docs bar never
        // shows under a full header nav.
        <div className="mx-auto w-full max-w-[1400px] px-6 grid grid-cols-[280px_minmax(0,1fr)] max-[861px]:grid-cols-1 gap-x-[clamp(32px,4vw,64px)] items-start">
          <aside
            aria-label={t("navSheetTitle")}
            className="sticky top-[86px] self-start max-h-[calc(100dvh-86px)] overflow-y-auto pr-2 py-8 [scrollbar-color:var(--mk-input-border)_transparent] [scrollbar-width:thin] max-[861px]:hidden"
          >
            <DocsSidebar onOpenSearch={() => setSearchOpen(true)} />
          </aside>
          <main id={MAIN_CONTENT_ID} className="py-8 min-w-0">
            <Outlet />
          </main>
        </div>
      )}

      <Sheet open={navOpen} onOpenChange={setNavOpen}>
        <SheetContent
          side="left"
          className="w-[300px] overflow-y-auto bg-mk-card"
          {...overlayFocus}
        >
          <SheetTitle className="sr-only">{t("navSheetTitle")}</SheetTitle>
          <SheetDescription className="sr-only">
            {t("navSheetDescription")}
          </SheetDescription>
          {/* Clears the sheet's close button (top right) and keeps the rows off its edges. A link
              closes the sheet on its way to the page; folding a group keeps it open. */}
          <div
            className="px-4 pt-12 pb-6"
            onClick={(e) => {
              if (e.target instanceof Element && e.target.closest("a[href]")) {
                setNavOpen(false);
              }
            }}
          >
            <DocsSidebar
              onOpenSearch={() => {
                setNavOpen(false);
                setSearchOpen(true);
              }}
            />
          </div>
        </SheetContent>
      </Sheet>

      <DocsSearch
        open={searchOpen}
        onOpenChange={setSearchOpen}
        {...overlayFocus}
      />
    </DocsSearchProvider>
  );
}
