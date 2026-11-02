import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { buildNavTree, pagesForLocale } from "@/docs/nav";
import { cn } from "@/lib/utils";
import { Link } from "@tanstack/react-router";
import { ChevronRight, Search } from "lucide-react";
import { useMemo } from "react";
import { useLocale, useTranslations } from "use-intl";
import { pages } from "virtual:docs";

export function DocsSidebar({ onOpenSearch }: { onOpenSearch: () => void }) {
  const t = useTranslations("marketing.docs");
  const locale = useLocale();
  const navTree = useMemo(
    () => buildNavTree(pagesForLocale(pages, locale)),
    [locale],
  );
  return (
    <nav aria-label={t("navLabel")} className="flex flex-col gap-1">
      <button
        type="button"
        onClick={onOpenSearch}
        className="flex items-center gap-2.5 w-full h-10 px-3 mb-2 rounded-md bg-mk-card border border-mk-input-border text-mk-text-muted text-[14px] text-left transition-colors duration-150 hover:text-mk-text-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mk-ring"
      >
        <Search className="size-4 opacity-70" />
        <span>{t("searchTrigger")}</span>
        <kbd className="ml-auto text-[13px] px-1.5 py-0.5 rounded-sm bg-mk-muted">
          ⌘K
        </kbd>
      </button>

      {navTree.map((group) => (
        <Collapsible key={group.slug} defaultOpen>
          <CollapsibleTrigger className="group flex items-center gap-2 w-full py-2 mt-3 font-mk-heading font-normal text-[17px] text-mk-text-strong">
            <ChevronRight className="size-3.5 text-mk-text-muted transition-transform group-data-[state=open]:rotate-90" />
            {group.title}
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="flex flex-col gap-0.5 ml-1.5">
              {group.links.map((link) => (
                <Link
                  key={link.slug}
                  to="/docs/$"
                  params={{ _splat: link.slug }}
                  className="py-[6px] px-3 text-[15px] leading-snug rounded-sm transition-colors duration-150 text-mk-text-muted font-medium hover:text-mk-text-strong hover:bg-mk-muted"
                  activeProps={{
                    className: cn(
                      "py-[6px] px-3 text-[15px] leading-snug rounded-sm",
                      "text-mk-text-strong font-semibold bg-mk-sky-soft dark:bg-mk-muted",
                    ),
                  }}
                >
                  {link.title}
                </Link>
              ))}
            </div>
          </CollapsibleContent>
        </Collapsible>
      ))}
    </nav>
  );
}
