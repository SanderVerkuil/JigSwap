"use client";

// The shell's name for the current page, shared by every place that prints it: the desktop page
// head, the mobile top bar and the phone-only heading in the content area. The page gets exactly
// one h1 at every width: from md the page head's title is the h1 (the head is hidden below md);
// below md ShellHeading's sr-only h1 inside main is (the top-bar title is plain text in the
// banner). A page that renders its own visible h1 publishes `ownsHeading` (or `titleInContent`,
// which also drops the title line from the page head), and the shell then prints its title without
// any heading; `ownsHeading: "phone"` does so only below md, where that page's h1 shows.
import { usePathname } from "@/compat/navigation";
import type { ReactNode } from "react";
import { useTranslations } from "use-intl";
import { useDashboardGreeting } from "./greeting";
import { usePageHeaderContent } from "./page-header-slot";
import { getRouteMeta, type ShellRouteMeta } from "./route-meta";

export type ShellTitle = {
  meta: ShellRouteMeta | undefined;
  /** The route's static title (`shell.pages.<key>.title`). */
  pageTitle: string | undefined;
  /** The title the page published (dynamic routes), if any. */
  titleOverride: ReactNode;
  /** What the page is called: the published title, else the home greeting or the static title. */
  title: ReactNode;
  /** The page renders its own visible h1, so the shell's title must not be a heading. */
  ownsHeading: boolean | "phone";
};

export function useShellTitle(): ShellTitle {
  const pathname = usePathname();
  const meta = getRouteMeta(pathname);
  const t = useTranslations("shell");
  const greeting = useDashboardGreeting();
  const {
    title: titleOverride,
    titleInContent,
    ownsHeading = false,
  } = usePageHeaderContent();
  const pageTitle = meta ? t(`pages.${meta.pageKey}.title`) : undefined;
  const baseTitle = meta?.variant === "dashboard" ? greeting : pageTitle;
  return {
    meta,
    pageTitle,
    titleOverride,
    title: titleOverride ?? baseTitle,
    ownsHeading: titleInContent ? true : ownsHeading,
  };
}

/**
 * The page's h1 below md, where the page head is hidden: screen-reader only, inside main, and the
 * greeting on the home page. Nothing when the page renders its own h1.
 */
export function ShellHeading() {
  const { title, ownsHeading } = useShellTitle();
  if (ownsHeading || !title) return null;
  return <h1 className="sr-only md:hidden">{title}</h1>;
}
