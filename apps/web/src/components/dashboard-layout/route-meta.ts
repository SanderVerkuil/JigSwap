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
  Gavel,
  Globe,
  LayoutDashboard,
  type LucideIcon,
  Mail,
  MessageSquare,
  Puzzle,
  Search,
  Shapes,
  Shield,
  Tags,
  Target,
  ThumbsUp,
  Users,
} from "lucide-react";

export type ShellGroupKey = "library" | "community" | "admin";

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
      // The shared puzzle catalogue is discovery, not personal library — it lives
      // alongside Browse under Community.
      { key: "puzzles", href: "/puzzles", icon: Shapes },
      { key: "circles", href: "/circles", icon: Users },
      { key: "exchanges", href: "/trades", icon: ArrowLeftRight },
      { key: "messages", href: "/messages", icon: MessageSquare },
      { key: "people", href: "/people", icon: Globe },
    ],
  },
];

// The admin group is deliberately NOT in NAV_GROUPS: nothing renders it
// unconditionally. The sidebar and command palette render it only when the
// backend confirms the caller's admin role (gateway.identity.isAdmin).
export const ADMIN_GROUP: ShellNavGroup = {
  key: "admin",
  href: "/admin",
  icon: Shield,
  items: [
    { key: "adminModeration", href: "/admin/moderation", icon: Gavel },
    { key: "adminPuzzles", href: "/admin/puzzles", icon: Puzzle },
    { key: "adminCategories", href: "/admin/categories", icon: Tags },
    { key: "adminUsers", href: "/admin/users", icon: Users },
    { key: "adminContact", href: "/admin/contact", icon: Mail },
    { key: "adminFeedback", href: "/admin/feedback", icon: ThumbsUp },
  ],
};

export function getNavGroup(key: ShellGroupKey): ShellNavGroup {
  const group = [...NAV_GROUPS, ADMIN_GROUP].find((g) => g.key === key);
  if (!group) {
    // Unreachable: every ShellGroupKey has exactly one group defined above.
    throw new Error(`Unknown nav group: ${key}`);
  }
  return group;
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
  // Owner's own copy detail (gated): nav-highlights My Puzzles; the page publishes
  // its own "My Library › My Puzzles › <name>" crumbs + title at runtime.
  "/my-puzzles/$id": { pageKey: "myPuzzles", group: "library" },
  "/collections": { pageKey: "collections", group: "library" },
  "/completions": { pageKey: "completions", group: "library" },
  "/completions/new": { pageKey: "completionNew", group: "library" },
  "/goals": { pageKey: "goals", group: "library" },
  "/insights": { pageKey: "insights", group: "library" },

  // Community
  "/community": { pageKey: "community", variant: "landing" },
  "/browse": { pageKey: "browse", group: "community" },
  // Anyone's owned copy detail: nav-highlights Community; the page publishes its
  // own "Community › Owned Copies › <name>" crumbs + title at runtime.
  "/copies": { pageKey: "copyInstance", group: "community" },
  "/copies/$id": { pageKey: "copyInstance", group: "community" },
  // The shared puzzle catalogue (discovery) + its contribute sub-route.
  "/puzzles": { pageKey: "puzzles", group: "community" },
  "/puzzles/$id": { pageKey: "puzzles", group: "community" },
  "/puzzles/add": { pageKey: "contributePuzzle", group: "community" },
  "/circles": { pageKey: "circles", group: "community" },
  "/trades": { pageKey: "exchanges", group: "community" },
  "/messages": { pageKey: "messages", group: "community" },
  "/people": { pageKey: "people", group: "community" },
  // Public member profile: nav-highlights Community for signed-in viewers; the
  // anonymous tier renders the marketing shell instead (no shell meta needed).
  "/members": { pageKey: "members", group: "community" },
  "/members/$handle": { pageKey: "members", group: "community" },

  // Admin (gated: the group renders only for backend-confirmed admins).
  "/admin": { pageKey: "admin", variant: "landing" },
  "/admin/moderation": { pageKey: "adminModeration", group: "admin" },
  "/admin/puzzles": { pageKey: "adminPuzzles", group: "admin" },
  // Definition detail: nav-highlights Puzzles; the page publishes the
  // definition's title as the leaf crumb at runtime.
  "/admin/puzzles/$puzzleId": { pageKey: "adminPuzzles", group: "admin" },
  "/admin/puzzles/proposals": { pageKey: "adminPuzzles", group: "admin" },
  "/admin/puzzles/proposals/$proposalId": {
    pageKey: "adminPuzzles",
    group: "admin",
  },
  "/admin/categories": { pageKey: "adminCategories", group: "admin" },
  "/admin/users": { pageKey: "adminUsers", group: "admin" },
  // Member detail: nav-highlights Members; the page publishes the member's
  // name as the leaf crumb at runtime.
  "/admin/users/$userId": { pageKey: "adminUsers", group: "admin" },
  "/admin/contact": { pageKey: "adminContact", group: "admin" },
  "/admin/feedback": { pageKey: "adminFeedback", group: "admin" },

  // Routes removed from the nav but still alive.
  "/borrowed": { pageKey: "borrowed", group: "library" },
  "/notifications": { pageKey: "notifications" },
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
