"use client";

// Landing page for a sidebar nav group (/library, /community): a card-free
// directory of the group's surfaces as full-width rows — violet-tint icon
// chip, title, one-line description, chevron — separated by thin dividers,
// per the design handoff's GroupLanding. Driven entirely by the route-meta
// nav groups, so the IA stays defined in exactly one place.

import { Link } from "@/compat/link";
import { ChevronRight } from "lucide-react";
import { useTranslations } from "use-intl";
import { getNavGroup, type ShellGroupKey } from "./route-meta";

export function GroupLanding({ group }: { group: ShellGroupKey }) {
  const t = useTranslations("shell");
  const { items } = getNavGroup(group);

  return (
    <div className="flex max-w-[820px] flex-col">
      {items.map((item, index) => (
        <Link
          key={item.key}
          href={item.href}
          className={
            "group flex items-center gap-4 py-[17px] transition-colors" +
            (index === items.length - 1 ? "" : " border-b border-border/70")
          }
        >
          <span className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-sidebar-accent text-sidebar-accent-foreground">
            <item.icon className="size-[19px]" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block font-semibold text-foreground group-hover:text-sidebar-accent-foreground">
              {t(`pages.${item.key}.title`)}
            </span>
            <span className="mt-px block truncate text-sm text-muted-foreground">
              {t(`pages.${item.key}.description`)}
            </span>
          </span>
          <ChevronRight
            aria-hidden
            className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5"
          />
        </Link>
      ))}
    </div>
  );
}
