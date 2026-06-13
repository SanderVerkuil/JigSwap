"use client";

// Page head at the top of the inset content card: an optional breadcrumb row
// (`Group > Page` only — the group crumb links to its landing page; no crumbs
// on Dashboard, Profile or the landings themselves) above the page title and
// its muted one-line subtitle on the same baseline row. Desktop-only: below
// md the mobile top bar owns the title and the back affordance.

import { useUser } from "@/compat/clerk";
import { Link } from "@/compat/link";
import { usePathname } from "@/compat/navigation";
import { ChevronRight } from "lucide-react";
import { useTranslations } from "use-intl";
import { usePageHeaderSlot } from "./page-header-slot";
import { getNavGroup, getRouteMeta } from "./route-meta";

export function PageHead() {
  const pathname = usePathname();
  const meta = getRouteMeta(pathname);
  const t = useTranslations("shell");
  const { user } = useUser();
  const headerActions = usePageHeaderSlot();

  if (!meta) {
    return null;
  }

  const pageTitle = t(`pages.${meta.pageKey}.title`);
  const subtitle = t(`pages.${meta.pageKey}.subtitle`);
  const title =
    meta.variant === "dashboard"
      ? user?.firstName
        ? t("welcome", { name: user.firstName })
        : t("welcomeAnonymous")
      : pageTitle;
  const group =
    meta.group && meta.variant === undefined
      ? getNavGroup(meta.group)
      : undefined;

  return (
    <div className="hidden shrink-0 border-b bg-background px-4 pt-3.5 pb-3 md:block md:px-7">
      {group ? (
        <nav
          aria-label={t("breadcrumbLabel")}
          className="mb-0.5 flex items-center gap-1.5 text-xs text-muted-foreground"
        >
          <Link
            href={group.href}
            className="transition-colors hover:text-sidebar-accent-foreground hover:underline"
          >
            {t(`groups.${group.key}.label`)}
          </Link>
          <ChevronRight aria-hidden className="size-3" />
          <span className="text-foreground">{pageTitle}</span>
        </nav>
      ) : null}
      <div className="flex items-center gap-4">
        <div className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-3.5 gap-y-0.5">
          <h1 className="font-heading text-2xl font-bold tracking-tight">
            {title}
          </h1>
          <p className="min-w-0 truncate text-sm text-muted-foreground">
            {subtitle}
          </p>
        </div>
        {headerActions ? (
          <div className="flex shrink-0 items-center gap-2.5">
            {headerActions}
          </div>
        ) : null}
      </div>
    </div>
  );
}
