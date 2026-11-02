"use client";

// Page head at the top of the white sheet: an optional breadcrumb row
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
import { cn } from "@/lib/utils";
import { ChevronRight } from "lucide-react";
import { useTranslations } from "use-intl";
import { usePageHeaderContent } from "./page-header-slot";
import { getNavGroup, getRouteMeta, isFullBleedRoute } from "./route-meta";
import { PAGE_HEAD_HEIGHT_VAR, useHeightCssVar } from "./sticky-offset";

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
  // Sticky page content (tab bars) sticks just below this head.
  const measureRef = useHeightCssVar(PAGE_HEAD_HEIGHT_VAR);

  if (!meta) {
    return null;
  }

  const pageTitle = t(`pages.${meta.pageKey}.title`);
  // The dashboard's own sentence sits right below, so its head stays a bare title.
  const subtitle =
    titleOverride || meta.variant === "dashboard"
      ? null
      : t(`pages.${meta.pageKey}.subtitle`);
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

  const crumbLink = "transition-colors hover:text-foreground hover:underline";

  return (
    // Sticks to the top of the shared scroll region on a solid ground, one quiet edge below it. z-20
    // keeps it above the scrolling content. Its 24px sides share the content's left edge. The edge
    // runs on the content's column too, since the scrollbar's reserved gutter would cut a full-width
    // rule short of the sheet's side; a full-bleed page has no gutter and panes that meet the sides.
    <div
      ref={measureRef}
      className={cn(
        "bg-background sticky top-0 z-20 hidden px-6 pt-3 pb-3 md:block",
        isFullBleedRoute(pathname)
          ? "border-b"
          : "after:bg-border after:absolute after:inset-x-6 after:bottom-0 after:h-px",
      )}
    >
      {crumbs && crumbs.length > 0 ? (
        // Explicit trail published by the page (deep routes).
        <nav
          aria-label={t("breadcrumbLabel")}
          className="mb-0.5 flex flex-wrap items-center gap-1.5 text-[13px] text-muted-foreground"
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
          className="mb-0.5 flex items-center gap-1.5 text-[13px] text-muted-foreground"
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
      {/* Actions drop to their own row before they squeeze the title onto two lines. */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="flex min-w-60 flex-1 flex-wrap items-baseline gap-x-3.5 gap-y-0.5">
          <h1 className="font-heading text-2xl">{title}</h1>
          {subtitle && (
            <p className="min-w-0 truncate text-sm text-muted-foreground">
              {subtitle}
            </p>
          )}
        </div>
        {headerActions ? (
          <div className="ml-auto flex max-w-full flex-wrap items-center justify-end gap-2.5 md:shrink-0">
            {headerActions}
          </div>
        ) : null}
      </div>
    </div>
  );
}
