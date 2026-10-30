// Which empty state the notifications page shows. Filtering runs on the client over the pages
// already loaded, so an empty filtered list must not read as "no notifications" (UX-122): it
// either means everything is read, or nothing in the loaded pages matches the filters.
export type NotificationEmptyState =
  | { kind: "none" }
  | { kind: "caughtUp" }
  | { kind: "noMatch"; moreToLoad: boolean };

export function emptyStateFor({
  loaded,
  shown,
  unreadOnly,
  unreadTotal,
  canLoadMore,
}: {
  /** Rows loaded so far (all pages, before filtering). */
  loaded: number;
  /** Rows left after the category and unread filters. */
  shown: number;
  unreadOnly: boolean;
  /** The server's unread count, which covers rows beyond the loaded pages. */
  unreadTotal: number;
  /** More pages exist beyond the loaded ones. */
  canLoadMore: boolean;
}): NotificationEmptyState | null {
  if (shown > 0) return null;
  if (loaded === 0) return { kind: "none" };
  if (unreadOnly && unreadTotal === 0) return { kind: "caughtUp" };
  return { kind: "noMatch", moreToLoad: canLoadMore };
}
