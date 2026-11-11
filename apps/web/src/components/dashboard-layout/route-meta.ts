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
  Blend,
  BookOpen,
  CircleCheck,
  FolderOpen,
  Gavel,
  Globe,
  House,
  LayoutDashboard,
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
  type LucideIcon,
} from "lucide-react";

export type ShellGroupKey = "library" | "community" | "admin";

export type ShellNavItem = {
  /** i18n key under `shell.pages.*` (title/subtitle/description). */
  key: string;
  href: string;
  icon: LucideIcon;
  /**
   * Extra words the ⌘K palette matches besides the localized title: the other language's title
   * and common synonyms, in English AND Dutch, so a member finds the page in either language.
   * Lower case; never shown. A word's plain endings match by themselves ("trade" finds "trades"),
   * so list the base form, plus any form that changes the word ("verkoop" next to "verkopen").
   */
  keywords?: readonly string[];
};

export type ShellNavGroup = {
  key: ShellGroupKey;
  /** The group label links to this landing page. */
  href: string;
  icon: LucideIcon;
  /** Palette keywords for the landing page; see ShellNavItem.keywords. */
  keywords?: readonly string[];
  items: ShellNavItem[];
};

export const DASHBOARD_ITEM: ShellNavItem = {
  key: "dashboard",
  href: "/dashboard",
  icon: LayoutDashboard,
  keywords: ["home", "overview", "overzicht", "start"],
};

// Deduplicated IA per the design handoff: Dashboard ungrouped, then
// My Library and Community. Borrowed/Notifications stay routable but
// intentionally have no nav entry.
export const NAV_GROUPS: ShellNavGroup[] = [
  {
    key: "library",
    href: "/library",
    icon: BookOpen,
    keywords: ["library", "bibliotheek", "shelf", "plank"],
    items: [
      {
        key: "myPuzzles",
        href: "/my-puzzles",
        icon: Puzzle,
        keywords: [
          "my puzzles",
          "mijn puzzels",
          "copy",
          "copies",
          "exemplaar",
          "exemplaren",
        ],
      },
      {
        key: "collections",
        href: "/collections",
        icon: FolderOpen,
        keywords: ["collections", "collecties", "lists", "lijsten"],
      },
      {
        key: "household",
        href: "/household",
        icon: House,
        keywords: ["household", "huishouden", "family", "gezin"],
      },
      {
        key: "completions",
        href: "/completions",
        icon: CircleCheck,
        keywords: [
          "completions",
          "complete",
          "voltooiingen",
          "solve",
          "voltooid",
        ],
      },
      {
        key: "goals",
        href: "/goals",
        icon: Target,
        keywords: ["goals", "doelen", "challenge", "uitdaging"],
      },
      {
        key: "insights",
        href: "/insights",
        icon: BarChart3,
        keywords: ["insights", "inzichten", "stats", "statistieken"],
      },
    ],
  },
  {
    key: "community",
    href: "/community",
    icon: Users,
    keywords: ["community", "gemeenschap"],
    items: [
      {
        key: "browse",
        href: "/browse",
        icon: Search,
        keywords: [
          "browse",
          "ontdekken",
          "discover",
          "available",
          "beschikbaar",
        ],
      },
      // The shared puzzle catalogue is discovery, not personal library — it lives
      // alongside Browse under Community.
      {
        key: "puzzles",
        href: "/puzzles",
        icon: Shapes,
        keywords: ["catalogue", "catalog", "catalogus", "puzzels"],
      },
      // Two overlapping rings: Users already stands for Community (its tab and hub).
      {
        key: "circles",
        href: "/circles",
        icon: Blend,
        keywords: ["circles", "kringen", "groups", "groepen"],
      },
      {
        key: "exchanges",
        href: "/trades",
        icon: ArrowLeftRight,
        keywords: [
          "exchange",
          "exchanges",
          "uitwisselingen",
          "swap",
          "trade",
          "lend",
          "lent",
          "borrow",
          "loan",
          "sell",
          "sold",
          "sales",
          "ruil",
          "ruilen",
          "geruild",
          "leen",
          "lenen",
          "lening",
          "geleend",
          "uitleen",
          "uitlenen",
          "verkoop",
          "verkoper",
          "verkopen",
          "verkocht",
        ],
      },
      {
        key: "messages",
        href: "/messages",
        icon: MessageSquare,
        keywords: [
          "message",
          "messages",
          "berichten",
          "chat",
          "inbox",
          "gesprekken",
        ],
      },
      {
        key: "people",
        href: "/people",
        icon: Globe,
        keywords: [
          "people",
          "person",
          "mensen",
          "members",
          "lid",
          "leden",
          "follow",
          "volg",
          "volgen",
        ],
      },
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
  keywords: ["admin", "beheer"],
  items: [
    {
      key: "adminModeration",
      href: "/admin/moderation",
      icon: Gavel,
      keywords: ["moderation", "moderatie", "reports"],
    },
    {
      key: "adminPuzzles",
      href: "/admin/puzzles",
      icon: Puzzle,
      keywords: ["admin puzzles", "proposals", "voorstellen"],
    },
    {
      key: "adminCategories",
      href: "/admin/categories",
      icon: Tags,
      keywords: ["categories", "categorieën"],
    },
    {
      key: "adminUsers",
      href: "/admin/users",
      icon: Users,
      keywords: ["users", "gebruikers"],
    },
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
  /** The page above this one on a route outside the nav groups: the phone's back chevron's way up. */
  parent?: { href: string; pageKey: string };
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
  // Top-level like /profile (no crumb row); reached from the sidebar footer, the user menu and the
  // mobile quick sheet rather than a nav group.
  "/whats-new": { pageKey: "whatsNew" },
  // The quick start flow: top-level, no crumb row (opened from the dashboard and the user menu).
  "/welcome": { pageKey: "quickSetup" },

  // My Library
  "/library": { pageKey: "library", variant: "landing" },
  "/my-puzzles": { pageKey: "myPuzzles", group: "library" },
  "/my-puzzles/add": { pageKey: "addPuzzle", group: "library" },
  "/my-puzzles/add/new": { pageKey: "createPuzzle", group: "library" },
  "/my-puzzles/add/quick": { pageKey: "quickAddPuzzles", group: "library" },
  // Owner's own copy detail (gated): nav-highlights My Puzzles; the page publishes
  // its own "My Library › My Puzzles › <name>" crumbs + title at runtime.
  "/my-puzzles/$id": { pageKey: "myPuzzles", group: "library" },
  "/collections": { pageKey: "collections", group: "library" },
  "/household": { pageKey: "household", group: "library" },
  "/completions": { pageKey: "completions", group: "library" },
  "/completions/new": { pageKey: "completionNew", group: "library" },
  "/completions/past": { pageKey: "completionPast", group: "library" },
  "/goals": { pageKey: "goals", group: "library" },
  "/insights": { pageKey: "insights", group: "library" },

  // Community
  "/community": { pageKey: "community", variant: "landing" },
  "/browse": { pageKey: "browse", group: "community" },
  // Anyone's owned copy detail: nav-highlights Community; the page publishes its
  // own "Community › Browse Puzzles › <name>" crumbs + title at runtime.
  "/copies": { pageKey: "copyInstance", group: "community" },
  "/copies/$id": { pageKey: "copyInstance", group: "community" },
  // The shared puzzle catalogue (discovery) + its contribute sub-route.
  "/puzzles": { pageKey: "puzzles", group: "community" },
  "/puzzles/$id": { pageKey: "puzzles", group: "community" },
  "/puzzles/add": { pageKey: "contributePuzzle", group: "community" },
  // Titled while the puzzle loads, so the catalogue's head doesn't stand in for it; the form then
  // publishes its own title and "Community › Puzzles catalogue › <puzzle>" crumbs.
  "/puzzles/$id/suggest-edit": { pageKey: "suggestEdit", group: "community" },
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

  // Old path that redirects to Exchanges › Loans (/trades?tab=loans); it resolves to the Exchanges
  // head so nothing flashes untitled while it does.
  "/borrowed": { pageKey: "exchanges", group: "community" },

  // Routes removed from the nav but still alive.
  "/notifications": { pageKey: "notifications" },
  // Ungrouped like its parent (no ShellGroupKey fits); the page itself publishes
  // an explicit "Notifications" crumb via usePageHeader.
  "/notifications/preferences": {
    pageKey: "notificationPreferences",
    parent: { href: "/notifications", pageKey: "notifications" },
  },
};

/**
 * Resolve the shell meta for a pathname: exact, then a key of the same depth whose `$param`
 * segments stand for any one segment (/puzzles/$id/suggest-edit), then the longest prefix.
 */
export function getRouteMeta(pathname: string): ShellRouteMeta | undefined {
  const clean = pathname.replace(/\/+$/, "") || "/";
  const exact = ROUTE_META[clean];
  if (exact) return exact;

  const segments = clean.split("/");
  for (const [path, meta] of Object.entries(ROUTE_META)) {
    const parts = path.split("/");
    if (
      path.includes("$") &&
      parts.length === segments.length &&
      parts.every(
        (part, i) =>
          part === segments[i] || (part.startsWith("$") && segments[i] !== ""),
      )
    ) {
      return meta;
    }
  }

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

export type MobileTabKey = "home" | "library" | "swaps" | "community";

// The phone tab bar's four destinations around its raised "+".
export const MOBILE_TABS: ReadonlyArray<{
  key: MobileTabKey;
  href: string;
  icon: LucideIcon;
}> = [
  { key: "home", href: "/dashboard", icon: LayoutDashboard },
  { key: "library", href: "/library", icon: BookOpen },
  { key: "swaps", href: "/trades", icon: ArrowLeftRight },
  { key: "community", href: "/community", icon: Users },
];

const MOBILE_TAB_ROOTS = new Set(MOBILE_TABS.map((tab) => tab.href));

/**
 * Pages a phone tab opens (Home, Library, Swaps, Community). The mobile top bar shows no back
 * chevron there: they are top-level destinations, even when (like /trades) they sit in a nav group.
 */
export function isMobileTabRoot(pathname: string): boolean {
  return MOBILE_TAB_ROOTS.has(pathname.replace(/\/+$/, "") || "/");
}

/**
 * Routes that take over the whole phone screen: the open thread and the new-conversation pane
 * (`/messages/<anything>`). Below md the mobile top bar and tab bar step aside there so the
 * thread header and composer own the viewport (and the tab bar can't ride above the keyboard).
 */
export function isImmersiveMobileRoute(pathname: string): boolean {
  return /^\/messages\/[^/]+/.test(pathname);
}

/**
 * Routes whose page fills the desktop content card edge to edge (/messages and its children): from
 * md the shell drops the content padding and its own scroll, so the page's panes (the thread list,
 * the message log) do the scrolling and run to the card's edges.
 */
export function isFullBleedRoute(pathname: string): boolean {
  return /^\/messages(\/|$)/.test(pathname);
}

/**
 * Routes that offer their own add actions in the page: My Puzzles and its add flow, and the
 * puzzle catalogue (contribute a puzzle, add a copy from a card or a puzzle's page). The desktop
 * top bar's "Add to my puzzles" shortcut steps aside there, so it never sits next to a second add
 * button that leads somewhere else.
 */
export function hasOwnAddAction(pathname: string): boolean {
  return /^\/(my-puzzles|puzzles)(\/|$)/.test(pathname);
}
