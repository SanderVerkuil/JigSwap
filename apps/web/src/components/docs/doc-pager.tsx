import type { Pager } from "@/docs/types";
import { Link } from "@tanstack/react-router";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { useTranslations } from "use-intl";

export function DocPager({ pager }: { pager: Pager }) {
  const t = useTranslations("marketing.docs");
  return (
    <nav
      aria-label={t("pagerLabel")}
      className="grid grid-cols-2 gap-4 mt-14 pt-8 border-t border-mk-border max-[560px]:grid-cols-1"
    >
      {pager.prev ? (
        <Link
          to="/docs/$"
          params={{ _splat: pager.prev.slug }}
          className="group flex flex-col gap-1 rounded-md bg-mk-muted p-4 transition-[background-color] duration-150 hover:bg-mk-sky-soft dark:hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mk-ring"
        >
          <span className="flex items-center gap-1 text-[14px] text-mk-text-muted">
            <ArrowLeft className="size-3.5" /> {t("pagerPrevious")}
          </span>
          <span className="font-mk-heading text-[17px] text-mk-text-strong">
            {pager.prev.title}
          </span>
        </Link>
      ) : (
        <span />
      )}
      {pager.next ? (
        <Link
          to="/docs/$"
          params={{ _splat: pager.next.slug }}
          className="group flex flex-col gap-1 items-end text-right rounded-md bg-mk-muted p-4 transition-[background-color] duration-150 hover:bg-mk-sky-soft dark:hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mk-ring"
        >
          <span className="flex items-center gap-1 text-[14px] text-mk-text-muted">
            {t("pagerNext")} <ArrowRight className="size-3.5" />
          </span>
          <span className="font-mk-heading text-[17px] text-mk-text-strong">
            {pager.next.title}
          </span>
        </Link>
      ) : (
        <span />
      )}
    </nav>
  );
}
