"use client";

// Landing page for a sidebar nav group (/library, /community, /admin): a
// launcher tile grid of the group's surfaces — violet-tint icon chip, title,
// 2-line description, hover chevron — per the content-width conformance
// design (tile grid deliberately chosen over a row directory so these pages
// feel like a "home" surface). Driven entirely by the route-meta nav groups,
// so the IA stays defined in exactly one place.

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
          className="group flex flex-col gap-3 rounded-xl border p-5 transition-colors outline-none hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-sidebar-accent text-sidebar-accent-foreground">
            <item.icon className="size-[19px]" />
          </span>
          <span className="flex flex-1 flex-col gap-1">
            <span className="font-medium text-foreground">
              {t(`pages.${item.key}.title`)}
            </span>
            <span className="line-clamp-2 text-sm text-muted-foreground">
              {t(`pages.${item.key}.description`)}
            </span>
          </span>
          <ChevronRight
            aria-hidden
            className="size-4 shrink-0 self-end text-muted-foreground transition-transform group-hover:translate-x-0.5"
          />
        </Link>
      ))}
    </div>
  );
}
