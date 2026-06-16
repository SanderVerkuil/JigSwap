import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import { Link } from "@tanstack/react-router";
import { ChevronRight, Search } from "lucide-react";
import { useTranslations } from "use-intl";
import { navTree } from "virtual:docs";

export function DocsSidebar({ onOpenSearch }: { onOpenSearch: () => void }) {
  const t = useTranslations("marketing.docs");
  return (
    <nav aria-label={t("navLabel")} className="flex flex-col gap-1">
      <button
        type="button"
        onClick={onOpenSearch}
        className="flex items-center gap-2.5 w-full h-10 px-3 mb-2 rounded-[10px] bg-mk-card border border-mk-border text-mk-text-muted text-[14px] text-left transition-colors hover:border-mk-violet-300 hover:text-mk-text-body focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mk-ring"
      >
        <Search className="size-4 opacity-70" />
        <span>{t("searchTrigger")}</span>
        <kbd className="ml-auto font-mono text-[11px] px-1.5 py-0.5 rounded-[5px] bg-mk-muted border border-mk-border">
          ⌘K
        </kbd>
      </button>

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
