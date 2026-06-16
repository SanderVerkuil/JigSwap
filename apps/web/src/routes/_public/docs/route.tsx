import { DocsMobileBar } from "@/components/docs/docs-mobile-bar";
import { DocsSearch } from "@/components/docs/docs-search";
import { DocsSidebar } from "@/components/docs/docs-sidebar";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@/components/ui/sheet";
import { Outlet, createFileRoute, useLocation } from "@tanstack/react-router";
import * as React from "react";
import { useTranslations } from "use-intl";

export const Route = createFileRoute("/_public/docs")({
  component: DocsLayout,
});

function DocsLayout() {
  const t = useTranslations("marketing.docs");
  const [searchOpen, setSearchOpen] = React.useState(false);
  const [navOpen, setNavOpen] = React.useState(false);

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
    <>
      <a
        href="#docs-content"
        className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:top-2 focus:left-2 focus:rounded-md focus:bg-mk-card focus:px-3 focus:py-2 focus:ring-2 focus:ring-mk-ring"
      >
        {t("skipToContent")}
      </a>
      <DocsMobileBar
        onOpenNav={() => setNavOpen(true)}
        onOpenSearch={() => setSearchOpen(true)}
      />
      {isIndex ? (
        // Full-width landing: no sidebar, no horizontal padding/max-width so the
        // PageHero band can bleed edge-to-edge. The page supplies its own
        // Container for the card grid.
        <main id="docs-content" className="min-w-0">
          <Outlet />
        </main>
      ) : (
        <div className="mx-auto w-full max-w-[1400px] px-6 grid grid-cols-[280px_minmax(0,1fr)] max-[1000px]:grid-cols-1 gap-x-[clamp(32px,4vw,64px)] items-start">
          <aside className="sticky top-[86px] self-start max-h-[calc(100vh-86px)] overflow-y-auto pr-6 border-r border-mk-border py-8 max-[1000px]:hidden">
            <DocsSidebar onOpenSearch={() => setSearchOpen(true)} />
          </aside>
          <main id="docs-content" className="py-8 min-w-0">
            <Outlet />
          </main>
        </div>
      )}

      <Sheet open={navOpen} onOpenChange={setNavOpen}>
        <SheetContent
          side="left"
          className="w-[300px] overflow-y-auto bg-mk-card"
        >
          <SheetTitle className="sr-only">{t("navSheetTitle")}</SheetTitle>
          <SheetDescription className="sr-only">
            {t("navSheetDescription")}
          </SheetDescription>
          <div className="py-6" onClick={() => setNavOpen(false)}>
            <DocsSidebar
              onOpenSearch={() => {
                setNavOpen(false);
                setSearchOpen(true);
              }}
            />
          </div>
        </SheetContent>
      </Sheet>

      <DocsSearch open={searchOpen} onOpenChange={setSearchOpen} />
    </>
  );
}
