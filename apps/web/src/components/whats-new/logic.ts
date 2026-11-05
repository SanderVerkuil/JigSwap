// Pure What's new display rules, kept free of React/Convex so they unit-test in node.

import type {
  WhatsNewEntry,
  WhatsNewLocalizedContent,
} from "@/whats-new/types";
import type { WhatsNewCategory } from "@jigswap/contracts";

export interface MonthGroup<T> {
  /** UTC `YYYY-MM`. */
  key: string;
  /** Epoch ms of the first instant of the month (UTC), for formatting the heading. */
  monthStart: number;
  entries: T[];
}

/**
 * Group newest-first entries by their UTC month, preserving input order. UTC because
 * `publishedAt` is a UTC date (a bare frontmatter date is 00:00 UTC), and the month of an entry
 * must not depend on the reader's clock or differ between the server render and hydration.
 */
export function groupByMonth<T extends { publishedAt: number }>(
  entries: readonly T[],
): MonthGroup<T>[] {
  const groups = new Map<string, MonthGroup<T>>();
  for (const entry of entries) {
    const date = new Date(entry.publishedAt);
    const key = date.toISOString().slice(0, 7);
    let group = groups.get(key);
    if (!group) {
      group = {
        key,
        monthStart: Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1),
        entries: [],
      };
      groups.set(key, group);
    }
    group.entries.push(entry);
  }
  return [...groups.values()];
}

/** The entry's UTC calendar date as `YYYY-MM-DD` (for `<time dateTime>`). */
export function isoDateUtc(publishedAt: number): string {
  return new Date(publishedAt).toISOString().slice(0, 10);
}

/**
 * Unread ids the web bundle can render. Web and Convex deploy separately, so an id only one side
 * knows is ignored (spec §A6).
 */
export function knownUnreadIds(
  unreadIds: readonly string[],
  knownIds: ReadonlySet<string>,
): string[] {
  return unreadIds.filter((id) => knownIds.has(id));
}

/** The newest unread entry with `highlight: true` (entries are newest first). */
export function pickHighlightEntry<
  T extends { id: string; highlight: boolean },
>(entries: readonly T[], unreadIds: readonly string[]): T | undefined {
  const unread = new Set(unreadIds);
  return entries.find((entry) => entry.highlight && unread.has(entry.id));
}

/**
 * The highlight modal's priority rule (spec §A6, D9): it is the lowest-priority surface, so it
 * opens only when nothing else is on screen or pending, at most once per session, and never on
 * /whats-new itself or the quick start flow (/welcome).
 */
export function canOpenHighlight(state: {
  pathname: string;
  shownThisSession: boolean;
  hasCandidate: boolean;
  /** A task-flow prompt (e.g. the completion follow-up) or a tour is active. */
  surfaceBusy: boolean;
  /** Any Radix dialog or sheet is open. */
  dialogOpen: boolean;
}): boolean {
  const path = state.pathname.replace(/\/+$/, "");
  // Never on the changelog itself, nor over the quick start flow (even between its steps).
  const excluded = path === "/whats-new" || path === "/welcome";
  return (
    state.hasCandidate &&
    !state.shownThisSession &&
    !excluded &&
    !state.surfaceBusy &&
    !state.dialogOpen
  );
}

/**
 * What the shell live region announces when the unread count changes: the new total, but only on
 * an increase after the count first loaded (`undefined` = still loading). Never on first load or
 * on a decrease, so the badge is not read out on every page load or after visiting the page.
 */
export function announcedCount(
  previous: number | undefined,
  next: number | undefined,
): number | null {
  if (previous === undefined || next === undefined) return null;
  return next > previous ? next : null;
}

/** Badge text: more than nine unseen entries is unrealistic, so the pill caps at "9+". */
export function formatWhatsNewCount(count: number): string {
  return count > 9 ? "9+" : String(count);
}

/** The entry's copy for the active UI locale (`en` for any locale the content does not have). */
export function contentFor(
  entry: WhatsNewEntry,
  locale: string,
): WhatsNewLocalizedContent {
  return locale === "nl" ? entry.content.nl : entry.content.en;
}

/** How many entries the Updates tab shows before "Show older updates". */
export const WHATS_NEW_PAGE_SIZE = 10;

/** The category filter's choices, in display order after "All". */
export const WHATS_NEW_CATEGORIES: readonly WhatsNewCategory[] = [
  "feature",
  "improvement",
  "fix",
];

export type WhatsNewCategoryFilter = WhatsNewCategory | "all";

/**
 * The entries the Updates tab renders (UX-90): the newest `pageSize` in the chosen category, plus
 * every unread entry in it (the visit marks the unread snapshot seen, so each one must be on
 * screen) and the deep-linked entry wherever it is (the member asked for it); everything in the
 * category once older updates are shown. `olderCount` is how many entries in the category are
 * left out. Order is the input's (newest first).
 */
export function visibleEntries<
  T extends { id: string; category: WhatsNewCategory },
>({
  entries,
  category,
  showOlder,
  unreadIds,
  deepLinkId,
  pageSize = WHATS_NEW_PAGE_SIZE,
}: {
  entries: readonly T[];
  category: WhatsNewCategoryFilter;
  showOlder: boolean;
  /** Undefined while the read state loads. */
  unreadIds: readonly string[] | undefined;
  deepLinkId: string | undefined;
  pageSize?: number;
}): { visible: T[]; olderCount: number } {
  const unread = new Set(unreadIds);
  const visible: T[] = [];
  let inCategory = 0;
  let olderCount = 0;
  for (const entry of entries) {
    const matches = category === "all" || entry.category === category;
    const position = matches ? inCategory++ : -1;
    const shown =
      entry.id === deepLinkId ||
      (matches && (showOlder || position < pageSize || unread.has(entry.id)));
    if (shown) visible.push(entry);
    else if (matches) olderCount++;
  }
  return { visible, olderCount };
}

/** The categories the entries use, in the filter's order (the filter offers only these). */
export function categoriesIn(
  entries: readonly { category: WhatsNewCategory }[],
): WhatsNewCategory[] {
  const used = new Set(entries.map((entry) => entry.category));
  return WHATS_NEW_CATEGORIES.filter((category) => used.has(category));
}
