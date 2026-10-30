"use client";

// Page head at the top of the inset content card: a breadcrumb row above the
// page title and its muted subtitle, then the page's published meta and
// actions. Two breadcrumb shapes:
//   • normal page:  Group › Page         (group links to its landing)
//   • dynamic page: Group › Page › Leaf   (a page publishing a title override,
//     e.g. a collection's name, via usePageHeader — the route's own title
//     becomes a middle crumb linking back to the listing).
// No crumbs on Dashboard, Profile or the landings themselves, but the crumb row
// is reserved everywhere so the h1 sits at the same height on every page.
// The title row wraps: when the actions don't fit beside the title they move
// to their own line rather than squeezing the title or running off the card.
// Desktop-only: below md the mobile top bar owns the title and the back
// affordance, and the shell's MobilePageActions row carries the actions.
import { useUser } from "@/compat/clerk";
import { Link } from "@/compat/link";
import { usePathname } from "@/compat/navigation";
import { ChevronRight } from "lucide-react";
import { useTranslations } from "use-intl";
import { usePageHeaderContent } from "./page-header-slot";
import { getNavGroup, getRouteMeta } from "./route-meta";
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
    meta: headerMeta,
  } = usePageHeaderContent();
  // Sticky page content (tab bars) sticks just below this head.
  const measureRef = useHeightCssVar(PAGE_HEAD_HEIGHT_VAR);

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

  const crumbTrail =
    crumbs && crumbs.length > 0 ? (
      // Explicit trail published by the page (deep routes).
      <nav
        aria-label={t("breadcrumbLabel")}
        className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground"
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
        className="flex items-center gap-1.5 text-xs text-muted-foreground"
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
    ) : null;

  return (
    // Glass head: sticks to the top of the shared scroll region and frosts the content scrolling
    // beneath it. Solid bg is the fallback; where backdrop-filter is supported the bg goes
    // translucent so the blur reads. z-20 keeps it above the scrolling content.
    <div
      ref={measureRef}
      data-slot="page-head"
      className="bg-background supports-[backdrop-filter]:bg-background/70 sticky top-0 z-20 hidden border-b px-4 pt-3.5 pb-3 backdrop-blur-md md:block md:px-7"
    >
      {/* Reserved even when empty (one text-xs line) so the h1 never shifts between pages. */}
      <div
        data-slot="page-head-crumbs"
        aria-hidden={crumbTrail ? undefined : true}
        className="mb-0.5 min-h-4"
      >
        {crumbTrail}
      </div>
      <div
        data-slot="page-head-row"
        className="flex flex-wrap items-center gap-x-4 gap-y-2"
      >
        {/* Keeps at least 16rem (or the full row) for the title, so actions that don't fit
            beside it wrap onto their own line instead of crushing it. */}
        <div
          data-slot="page-head-title"
          className="flex min-w-[min(100%,16rem)] flex-1 flex-wrap items-baseline gap-x-3.5 gap-y-0.5"
        >
          <h1 className="font-heading text-2xl font-bold tracking-tight">
            {title}
          </h1>
          {!titleOverride && (
            <p className="text-sm text-muted-foreground">{subtitle}</p>
          )}
        </div>
        {headerMeta || headerActions ? (
          <div
            data-slot="page-head-actions"
            className="ml-auto flex flex-wrap items-center justify-end gap-2.5"
          >
            {/* Supplementary, so only where there is room for it next to the actions. */}
            {headerMeta ? (
              <span
                data-slot="page-head-meta"
                className="hidden text-sm text-muted-foreground xl:inline"
              >
                {headerMeta}
              </span>
            ) : null}
            {headerActions}
          </div>
        ) : null}
      </div>
    </div>
  );
}
