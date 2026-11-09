import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { buildNavTree, pagesForLocale } from "@/docs/nav";
import { cn } from "@/lib/utils";
import { Link } from "@tanstack/react-router";
import { ChevronRight } from "lucide-react";
import { useMemo } from "react";
import { useLocale, useTranslations } from "use-intl";
import { pages } from "virtual:docs";
import { DocsSearchPill } from "./docs-search-pill";
import { OnThisPageLink } from "./on-page-toc";

export function DocsSidebar({ onOpenSearch }: { onOpenSearch: () => void }) {
  const t = useTranslations("marketing.docs");
  const locale = useLocale();
  const navTree = useMemo(
    () => buildNavTree(pagesForLocale(pages, locale)),
    [locale],
  );
  return (
    <nav aria-label={t("navLabel")} className="flex flex-col gap-1">
      <DocsSearchPill onOpenSearch={onOpenSearch} />
      {/* From 861 to 1279px neither the rail beside the article nor the phone Docs bar shows; the
          sticky sidebar keeps the way back to the contents folded in under the title in reach. */}
      <OnThisPageLink className="hidden min-[861px]:max-[1280px]:flex items-center gap-2 ml-1.5 py-[6px] px-3 text-[15px] leading-snug rounded-sm transition-colors duration-150 text-mk-text-muted font-medium hover:text-mk-text-strong hover:bg-mk-muted dark:hover:bg-accent pointer-coarse:min-h-11" />

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
                  className="py-[6px] px-3 text-[15px] leading-snug rounded-sm transition-colors duration-150 text-mk-text-muted font-medium hover:text-mk-text-strong hover:bg-mk-muted dark:hover:bg-accent"
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
