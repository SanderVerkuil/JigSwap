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

      {navTree.map((group) => (
        <Collapsible key={group.slug} defaultOpen>
          <CollapsibleTrigger className="group flex items-center gap-2 w-full py-2 mt-3 font-mk-heading font-semibold text-[13px] tracking-[.04em] text-mk-text-strong">
            <ChevronRight className="size-3.5 text-mk-text-muted transition-transform group-data-[state=open]:rotate-90" />
            {group.title}
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="flex flex-col border-l border-mk-border ml-1.5">
              {group.links.map((link) => (
                <Link
                  key={link.slug}
                  to="/docs/$"
                  params={{ _splat: link.slug }}
                  className="-ml-px border-l-2 py-[6px] px-3.5 text-[13.5px] leading-snug rounded-r-[6px] transition-colors border-transparent text-mk-text-muted font-medium hover:text-mk-text-body hover:bg-mk-muted/60"
                  activeProps={{
                    className: cn(
                      "-ml-px border-l-2 py-[6px] px-3.5 text-[13.5px] leading-snug rounded-r-[6px]",
                      "border-mk-violet-400 text-mk-violet-600 font-semibold bg-mk-violet-50",
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
