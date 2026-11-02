"use client";

// Landing page for a sidebar nav group (/library, /community, /admin): a
// launcher tile grid of the group's surfaces: bare icon, title, 2-line
// description and hover chevron, per the content-width conformance design (tile
// grid deliberately chosen over a row directory so these pages feel like a
// "home" surface). Driven entirely by the route-meta nav groups, so the IA stays
// defined in exactly one place.
import { Link } from "@/compat/link";
import { ChevronRight } from "lucide-react";
import { useTranslations } from "use-intl";
import { getNavGroup, type ShellGroupKey } from "./route-meta";

export function GroupLanding({ group }: { group: ShellGroupKey }) {
  const t = useTranslations("shell");
  const { items } = getNavGroup(group);

  return (
    <div className="grid w-full gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {items.map((item) => (
        <Link
          key={item.key}
          href={item.href}
          className="group flex items-start gap-3 rounded-lg border p-4 transition-colors outline-none hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-ring"
        >
          <item.icon className="mt-0.5 size-[18px] shrink-0 text-muted-foreground" />
          <span className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="font-semibold text-foreground">
              {t(`pages.${item.key}.title`)}
            </span>
            <span className="line-clamp-2 text-sm text-muted-foreground">
              {t(`pages.${item.key}.description`)}
            </span>
          </span>
          <ChevronRight
            aria-hidden
            className="mt-1 size-4 shrink-0 text-muted-foreground transition-transform duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] group-hover:translate-x-0.5"
          />
        </Link>
      ))}
    </div>
  );
}
