import { DocsMobileBar } from "@/components/docs/docs-mobile-bar";
import { DocsSearch } from "@/components/docs/docs-search";
import { DocsSidebar } from "@/components/docs/docs-sidebar";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@/components/ui/sheet";
import { Outlet, createFileRoute } from "@tanstack/react-router";
import * as React from "react";

export const Route = createFileRoute("/_public/docs")({
  component: DocsLayout,
});

function DocsLayout() {
  const [searchOpen, setSearchOpen] = React.useState(false);
  const [navOpen, setNavOpen] = React.useState(false);

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
      <DocsMobileBar
        onOpenNav={() => setNavOpen(true)}
        onOpenSearch={() => setSearchOpen(true)}
      />
      <div className="mx-auto w-full max-w-[1400px] px-6 grid grid-cols-[280px_minmax(0,1fr)] max-[1000px]:grid-cols-1 gap-x-[clamp(32px,4vw,64px)] items-start">
        <aside className="sticky top-[86px] self-start max-h-[calc(100vh-86px)] overflow-y-auto pr-6 border-r border-mk-border py-8 max-[1000px]:hidden">
          <DocsSidebar onOpenSearch={() => setSearchOpen(true)} />
        </aside>
        <main id="docs-content" className="py-8 min-w-0">
          <Outlet />
        </main>
      </div>

      <Sheet open={navOpen} onOpenChange={setNavOpen}>
        <SheetContent
          side="left"
          className="w-[300px] overflow-y-auto bg-mk-card"
        >
          <SheetTitle className="sr-only">Documentation navigation</SheetTitle>
          <SheetDescription className="sr-only">
            Browse the JigSwap documentation by topic.
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
