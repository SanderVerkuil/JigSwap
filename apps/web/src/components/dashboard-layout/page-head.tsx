"use client";

// Page head at the top of the inset content card: an optional breadcrumb row
// above the page title and its muted one-line subtitle. Two breadcrumb shapes:
//   • normal page:  Group › Page         (group links to its landing)
//   • dynamic page: Group › Page › Leaf   (a page publishing a title override,
//     e.g. a collection's name, via usePageHeader — the route's own title
//     becomes a middle crumb linking back to the listing).
// No crumbs on Dashboard, Profile or the landings themselves. Desktop-only:
// below md the mobile top bar owns the title and the back affordance.

import { useUser } from "@/compat/clerk";
import { Link } from "@/compat/link";
import { usePathname } from "@/compat/navigation";
import { ChevronRight } from "lucide-react";
import { useTranslations } from "use-intl";
import { usePageHeaderContent } from "./page-header-slot";
import { getNavGroup, getRouteMeta } from "./route-meta";

export function PageHead() {
  const pathname = usePathname();
  const meta = getRouteMeta(pathname);
  const t = useTranslations("shell");
  const { user } = useUser();
  const {
    title: titleOverride,
    crumbs,
    actions: headerActions,
  } = usePageHeaderContent();

  if (!meta) {
    return null;
  }

  const pageTitle = t(`pages.${meta.pageKey}.title`);
  const subtitle = t(`pages.${meta.pageKey}.subtitle`);
  const baseTitle =
    meta.variant === "dashboard"
      ? user?.firstName
        ? t("welcome", { name: user.firstName })
        : t("welcomeAnonymous")
      : pageTitle;
  // A published title (dynamic route) overrides the static route title.
  const title = titleOverride ?? baseTitle;
  const group =
    meta.group && meta.variant === undefined
      ? getNavGroup(meta.group)
      : undefined;
  // For a title-override page, link the route's own page as the middle crumb.
  const parentItem =
    titleOverride && group
      ? group.items.find((item) => item.key === meta.pageKey)
      : undefined;

  const crumbLink =
    "transition-colors hover:text-sidebar-accent-foreground hover:underline";

  return (
    <div className="hidden shrink-0 border-b bg-background px-4 pt-3.5 pb-3 md:block md:px-7">
      {crumbs && crumbs.length > 0 ? (
        // Explicit trail published by the page (deep routes).
        <nav
          aria-label={t("breadcrumbLabel")}
          className="mb-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground"
        >
          {crumbs.map((crumb, i) => (
            <span key={i} className="flex items-center gap-1.5">
              {crumb.href ? (
                <Link href={crumb.href} className={crumbLink}>
                  {crumb.label}
                </Link>
              ) : (
                <span>{crumb.label}</span>
              )}
              <ChevronRight aria-hidden className="size-3" />
            </span>
          ))}
          <span className="text-foreground">{title}</span>
        </nav>
      ) : group ? (
        <nav
          aria-label={t("breadcrumbLabel")}
          className="mb-0.5 flex items-center gap-1.5 text-xs text-muted-foreground"
        >
          <Link href={group.href} className={crumbLink}>
            {t(`groups.${group.key}.label`)}
          </Link>
          <ChevronRight aria-hidden className="size-3" />
          {parentItem ? (
            <>
              <Link href={parentItem.href} className={crumbLink}>
                {pageTitle}
              </Link>
              <ChevronRight aria-hidden className="size-3" />
              <span className="text-foreground">{title}</span>
            </>
          ) : (
            <span className="text-foreground">{pageTitle}</span>
          )}
        </nav>
      ) : null}
      <div className="flex items-center gap-4">
        <div className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-3.5 gap-y-0.5">
          <h1 className="font-heading text-2xl font-bold tracking-tight">
            {title}
          </h1>
          {!titleOverride && (
            <p className="min-w-0 truncate text-sm text-muted-foreground">
              {subtitle}
            </p>
          )}
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
