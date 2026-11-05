"use client";

// Page head at the top of the white sheet: a breadcrumb row above the
// page title and its muted subtitle, then the page's published meta and
// actions. Two breadcrumb shapes:
//   • normal page:  Group › Page         (group links to its landing)
//   • dynamic page: Group › Page › Leaf   (a page publishing a title override,
//     e.g. a collection's name, via usePageHeader — the route's own title
//     becomes a middle crumb linking back to the listing).
// A page whose content already shows its title as an h1 (titleInContent) gets
// only the breadcrumb (and actions) here, never a second title heading.
// No crumbs on Dashboard, Profile or the landings themselves, but the crumb row
// is reserved everywhere so the h1 sits at the same height on every page.
// The title row wraps: when the actions don't fit beside the title they move
// to their own line rather than squeezing the title or running off the sheet.
// Desktop-only: below md the mobile top bar shows the title and the back
// affordance, ShellHeading (shell-title.tsx) carries the page's h1, and the
// shell's MobilePageActions row carries the actions.
import { Link } from "@/compat/link";
import { usePathname } from "@/compat/navigation";
import { cn } from "@/lib/utils";
import { ChevronRight } from "lucide-react";
import { useTranslations } from "use-intl";
import { usePageHeaderContent } from "./page-header-slot";
import { getNavGroup, isFullBleedRoute } from "./route-meta";
import { useShellTitle } from "./shell-title";
import { PAGE_HEAD_HEIGHT_VAR, useHeightCssVar } from "./sticky-offset";

export function PageHead() {
  const t = useTranslations("shell");
  const pathname = usePathname();
  // A published title (dynamic route) overrides the static route title.
  const { meta, pageTitle, titleOverride, title, ownsHeading } =
    useShellTitle();
  const {
    titleInContent,
    crumbs,
    actions: headerActions,
    meta: headerMeta,
  } = usePageHeaderContent();
  // Sticky page content (tab bars) sticks just below this head.
  const measureRef = useHeightCssVar(PAGE_HEAD_HEIGHT_VAR);

  if (!meta) {
    return null;
  }

  // The dashboard's own sentence sits right below, so its head stays a bare title.
  const subtitle =
    titleOverride || meta.variant === "dashboard"
      ? null
      : t(`pages.${meta.pageKey}.subtitle`);
  // The page's h1 from md, unless the page renders its own h1 there (then plain text, same look).
  const TitleTag = ownsHeading === true ? "p" : "h1";
  const group =
    meta.group && meta.variant === undefined
      ? getNavGroup(meta.group)
      : undefined;
  // For a title-override page, link the route's own page as the middle crumb.
  const parentItem =
    titleOverride && group
      ? group.items.find((item) => item.key === meta.pageKey)
      : undefined;

  // On touch the crumb's hit box grows to 44px tall; the matching negative margin keeps the
  // breadcrumb row's height unchanged.
  const crumbLink =
    "transition-colors hover:text-foreground hover:underline pointer-coarse:relative pointer-coarse:-my-3.5 pointer-coarse:py-3.5";

  const crumbTrail =
    crumbs && crumbs.length > 0 ? (
      // Explicit trail published by the page (deep routes).
      <nav
        aria-label={t("breadcrumbLabel")}
        className="flex flex-wrap items-center gap-1.5 text-[13px] text-muted-foreground"
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
        className="flex items-center gap-1.5 text-[13px] text-muted-foreground"
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
    // Sticks to the top of the shared scroll region on a solid ground, one quiet edge below it. z-20
    // keeps it above the scrolling content. Its 24px sides share the content's left edge. The edge
    // runs on the content's column too, since the scrollbar's reserved gutter would cut a full-width
    // rule short of the sheet's side; a full-bleed page has no gutter and panes that meet the sides.
    // In a short window (a phone in landscape) it scrolls away: top bar plus head would take over a
    // third of the screen.
    <div
      ref={measureRef}
      data-slot="page-head"
      className={cn(
        "bg-background sticky top-0 z-20 hidden px-6 pt-3 pb-3 md:block [@media(max-height:500px)]:static",
        isFullBleedRoute(pathname)
          ? "border-b"
          : "after:bg-border after:absolute after:inset-x-6 after:bottom-0 after:h-px",
      )}
    >
      {/* Reserved even when empty (one crumb line) so the h1 never shifts between pages. */}
      <div
        data-slot="page-head-crumbs"
        aria-hidden={crumbTrail ? undefined : true}
        className="mb-0.5 min-h-5"
      >
        {crumbTrail}
      </div>
      {/* Top-aligned, so an action taller than the h1 line (a default-size button, a 44px
          touch target) never pushes the title down: the h1 sits at the same y on every page. */}
      <div
        data-slot="page-head-row"
        className="flex flex-wrap items-start gap-x-4 gap-y-2"
      >
        {/* A page that renders its own title h1 keeps it only as the breadcrumb leaf here.
            Otherwise this keeps at least 16rem (or the full row) for the title, so actions that
            don't fit beside it wrap onto their own line instead of crushing it. */}
        {!titleInContent && (
          <div
            data-slot="page-head-title"
            className="flex min-w-[min(100%,16rem)] flex-1 flex-wrap items-baseline gap-x-3.5 gap-y-0.5"
          >
            <TitleTag className="font-heading text-2xl">{title}</TitleTag>
            {subtitle && (
              <p className="text-sm text-muted-foreground">{subtitle}</p>
            )}
          </div>
        )}
        {headerMeta || headerActions ? (
          <div
            data-slot="page-head-actions"
            className="ml-auto flex min-h-8 flex-wrap items-center justify-end gap-2.5"
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
