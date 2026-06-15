// Central route metadata for the logged-in shell: the grouped navigation IA,
// the per-pathname page titles/subtitles, and the breadcrumb parents.
//
// This is THE single place sibling agents extend when adding a leaf route:
// add a `ROUTE_META` entry (and matching `shell.pages.<key>` strings in
// locales/{source,en,nl}.json) and the shell renders the page head, crumbs,
// nav highlight and command-palette entry — no shell component edits needed.
//
// All `*Key` fields point into the `shell` i18n namespace:
//   pages.<pageKey>.title / .subtitle / .description, groups.<group>.label / .blurb

import {
  ArrowLeftRight,
  BarChart3,
  BookOpen,
  CircleCheck,
  FolderOpen,
  Globe,
  LayoutDashboard,
  type LucideIcon,
  MessageSquare,
  Puzzle,
  Search,
  Shapes,
  Target,
  Users,
} from "lucide-react";

export type ShellGroupKey = "library" | "community";

export type ShellNavItem = {
  /** i18n key under `shell.pages.*` (title/subtitle/description). */
  key: string;
  href: string;
  icon: LucideIcon;
};

export type ShellNavGroup = {
  key: ShellGroupKey;
  /** The group label links to this landing page. */
  href: string;
  icon: LucideIcon;
  items: ShellNavItem[];
};

export const DASHBOARD_ITEM: ShellNavItem = {
  key: "dashboard",
  href: "/dashboard",
  icon: LayoutDashboard,
};

// Deduplicated IA per the design handoff: Dashboard ungrouped, then
// My Library and Community. Borrowed/Notifications stay routable but
// intentionally have no nav entry.
export const NAV_GROUPS: ShellNavGroup[] = [
  {
    key: "library",
    href: "/library",
    icon: BookOpen,
    items: [
      { key: "myPuzzles", href: "/my-puzzles", icon: Puzzle },
      { key: "puzzles", href: "/puzzles", icon: Shapes },
      { key: "collections", href: "/collections", icon: FolderOpen },
      { key: "completions", href: "/completions", icon: CircleCheck },
      { key: "goals", href: "/goals", icon: Target },
      { key: "insights", href: "/insights", icon: BarChart3 },
    ],
  },
  {
    key: "community",
    href: "/community",
    icon: Users,
    items: [
      { key: "browse", href: "/browse", icon: Search },
      { key: "circles", href: "/circles", icon: Users },
      { key: "exchanges", href: "/trades", icon: ArrowLeftRight },
      { key: "messages", href: "/messages", icon: MessageSquare },
      { key: "people", href: "/people", icon: Globe },
    ],
  },
];

export function getNavGroup(key: ShellGroupKey): ShellNavGroup {
  // Both keys are statically present in NAV_GROUPS.
  return NAV_GROUPS.find((group) => group.key === key) as ShellNavGroup;
}

export type ShellRouteMeta = {
  /** i18n key under `shell.pages.*`. */
  pageKey: string;
  /** Breadcrumb parent; the crumb links to the group's landing page. */
  group?: ShellGroupKey;
  /**
   * - "dashboard": personalised welcome title, no crumb row.
   * - "landing": group landing page, no crumb row.
   * - undefined: regular page (crumbs when `group` is set).
   */
  variant?: "dashboard" | "landing";
};

// Keyed by pathname. Sub-paths fall back to their longest registered prefix
// (e.g. /puzzles/123 inherits /puzzles), so detail routes get sensible
// heads without their own entry.
export const ROUTE_META: Record<string, ShellRouteMeta> = {
  "/dashboard": { pageKey: "dashboard", variant: "dashboard" },
  "/profile": { pageKey: "profile" },

  // My Library
  "/library": { pageKey: "library", variant: "landing" },
  "/my-puzzles": { pageKey: "myPuzzles", group: "library" },
  "/my-puzzles/add": { pageKey: "addPuzzle", group: "library" },
  "/my-puzzles/add/new": { pageKey: "createPuzzle", group: "library" },
  "/copies": { pageKey: "copyInstance", group: "library" },
  "/copies/$id": { pageKey: "copyInstance", group: "library" },
  "/collections": { pageKey: "collections", group: "library" },
  "/completions": { pageKey: "completions", group: "library" },
  "/goals": { pageKey: "goals", group: "library" },
  "/insights": { pageKey: "insights", group: "library" },

  // Community
  "/community": { pageKey: "community", variant: "landing" },
  "/browse": { pageKey: "browse", group: "community" },
  "/circles": { pageKey: "circles", group: "community" },
  "/trades": { pageKey: "exchanges", group: "community" },
  "/messages": { pageKey: "messages", group: "community" },
  "/people": { pageKey: "people", group: "community" },

  // The shared catalogue (in the library nav) and its contribute sub-route.
  "/puzzles": { pageKey: "puzzles", group: "library" },
  "/puzzles/add": { pageKey: "contributePuzzle", group: "library" },

  // Routes removed from the nav but still alive.
  "/borrowed": { pageKey: "borrowed", group: "library" },
  "/notifications": { pageKey: "notifications" },
  "/notifications/preferences": { pageKey: "notificationPreferences" },
};

/** Resolve the shell meta for a pathname (exact, then longest prefix). */
export function getRouteMeta(pathname: string): ShellRouteMeta | undefined {
  const clean = pathname.replace(/\/+$/, "") || "/";
  const exact = ROUTE_META[clean];
  if (exact) return exact;

  let best: ShellRouteMeta | undefined;
  let bestLength = 0;
  for (const [path, meta] of Object.entries(ROUTE_META)) {
    if (clean.startsWith(`${path}/`) && path.length > bestLength) {
      best = meta;
      bestLength = path.length;
    }
  }
  return best;
}
