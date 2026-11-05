"use client";

import { gateway, type Id } from "@/gateway";
import { convexQuery } from "@convex-dev/react-query";
import type { MyLibraryCopyView } from "@jigswap/contracts";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";

// How a library list (My Puzzles, the household's Puzzles tab) gets its rows without reading the
// whole library. Two sources, one result:
//
// - A plain list, narrowed only by whose copies it is: the first rows of library.myLibraryWindow.
// - Anything only the whole library can answer (search, sort, status pills): the page works out the
//   matching copies from the lean library.myLibraryIndex, in the member's locale, and passes their
//   ids; library.myLibraryCopies then joins just the first ones.
//
// Either way the list is one query whose window grows with Show more. It lives in the query cache
// and the window is remembered per view, so Back from a copy asks for the same rows again, gets them
// at once, and the router's scroll restoration lands where the member was (as Browse does).

// How many rows a page adds.
export const LIBRARY_PAGE_SIZE = 48;

// Mirrors the backend's LIBRARY_WINDOW_MAX: the deepest one list can be scrolled. Past it the member
// is told to search or filter.
export const LIBRARY_ROWS_MAX = 1000;

// The window each view had open when the member last left it. In memory only: a reload starts afresh.
const openRows = new Map<string, number>();

export interface LibraryRowEntry {
  id: string;
  /** The full row; undefined while it is being joined (render a placeholder). */
  copy?: MyLibraryCopyView;
}

export type LibraryWindowArgs = {
  owner?: "all" | "mine" | "household";
  memberId?: Id<"users">;
};

export function useLibraryRows({
  enabled,
  viewKey,
  windowArgs,
  ids,
}: {
  enabled: boolean;
  /** What identifies this view: the window is kept per key. */
  viewKey: string;
  /** Who the plain list covers. */
  windowArgs: LibraryWindowArgs;
  /**
   * The matching copies in order, when the view is worked out over the index; undefined while the
   * index loads; null for a plain list.
   */
  ids: readonly string[] | undefined | null;
}) {
  const [opened, setOpened] = useState(() => ({
    key: viewKey,
    limit: openRows.get(viewKey) ?? LIBRARY_PAGE_SIZE,
  }));
  // The window belongs to one view: under another it reads as that view's, without an effect to reset
  // it.
  const limit =
    opened.key === viewKey
      ? opened.limit
      : (openRows.get(viewKey) ?? LIBRARY_PAGE_SIZE);

  const plain = ids === null;
  const firstRows = useQuery({
    ...convexQuery(
      gateway.library.myLibraryWindow,
      enabled && plain ? { ...windowArgs, limit } : "skip",
    ),
    placeholderData: keepPreviousData,
  });

  const copyIds = useMemo(
    () => (ids ?? []).slice(0, limit) as Id<"ownedPuzzles">[],
    [ids, limit],
  );
  const copies = useQuery({
    ...convexQuery(
      gateway.library.myLibraryCopies,
      enabled && copyIds.length > 0 ? { copyIds } : "skip",
    ),
    placeholderData: keepPreviousData,
  });
  const joining = copies.data === undefined || copies.isPlaceholderData;

  const entries = useMemo((): LibraryRowEntry[] => {
    if (plain) {
      return (firstRows.data?.rows ?? []).map((copy) => ({
        id: copy._id,
        copy,
      }));
    }
    const byId = new Map((copies.data ?? []).map((copy) => [copy._id, copy]));
    // A copy the index still lists but the join no longer returns has just been deleted: leave it
    // out rather than leave a placeholder behind.
    return copyIds.flatMap((id): LibraryRowEntry[] => {
      const copy = byId.get(id);
      return copy || joining ? [{ id, copy }] : [];
    });
  }, [plain, firstRows.data, copies.data, copyIds, joining]);

  const hasMore = plain
    ? (firstRows.data?.hasMore ?? false)
    : (ids?.length ?? 0) > limit;
  const atMax = limit >= LIBRARY_ROWS_MAX;

  return {
    entries,
    /** The plain list's counts, from the owners' counters. */
    counts: plain ? firstRows.data : undefined,
    /** Nothing to show yet: the first rows of this view are on their way. */
    loading: plain ? firstRows.data === undefined : ids === undefined,
    /** The rows on screen belong to a previous window or view. */
    stale: plain ? firstRows.isPlaceholderData : joining && copyIds.length > 0,
    hasMore: hasMore && !atMax,
    /** More rows match than one list can show. */
    atMax: hasMore && atMax,
    loadMore: () => {
      const next = Math.min(limit + LIBRARY_PAGE_SIZE, LIBRARY_ROWS_MAX);
      openRows.set(viewKey, next);
      setOpened({ key: viewKey, limit: next });
    },
  };
}
