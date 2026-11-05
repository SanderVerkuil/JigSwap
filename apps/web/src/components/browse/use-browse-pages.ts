"use client";

import { gateway } from "@/gateway";
import { convexQuery } from "@convex-dev/react-query";
import { keepPreviousData, useQueries, useQuery } from "@tanstack/react-query";
import type { FunctionArgs, FunctionReturnType } from "convex/server";
import { useState } from "react";
import type { QueryBuilderState } from "./query-builder";

// Browse asks for other members' offers in offset pages of this size; "Load more" adds the next.
// The server must allow at least this many rows per call.
export const BROWSE_PAGE_SIZE = 48;

// How many pages each set of filters had open when the member last left Browse. Coming Back asks
// for that many again (from the query cache, so at once), so the page is as tall as before and the
// router's scroll restoration lands where the member was. In memory only: a reload starts afresh.
const openPages = new Map<string, number>();

type BrowsePage = FunctionReturnType<typeof gateway.library.browseOwned>;
export type BrowseRow = BrowsePage["ownedPuzzles"][number];
/** Every Browse filter; the paging (offset/limit) is added per page. */
export type BrowseArgs = Omit<
  FunctionArgs<typeof gateway.library.browseOwned>,
  "offset" | "limit"
>;

const pieceCount = (value: string): number | undefined => {
  const n = value.trim() === "" ? Number.NaN : Number(value);
  return Number.isFinite(n) ? n : undefined;
};

/** The builder's conditions as browse arguments. Every filter, availability included, runs on the
 *  server, so the total and "Load more" cover all matching offers. Empty values are left out. */
export function browseFilterArgs(
  query: QueryBuilderState,
  searchTerm: string,
  puzzleId: string | undefined,
): BrowseArgs {
  const args: BrowseArgs = { includeOwnPuzzles: false };
  if (query.category) args.category = query.category;
  if (query.condition) args.condition = query.condition;
  if (query.difficulty) args.difficulty = query.difficulty;
  const minPieceCount = pieceCount(query.minPieces);
  if (minPieceCount !== undefined) args.minPieceCount = minPieceCount;
  const maxPieceCount = pieceCount(query.maxPieces);
  if (maxPieceCount !== undefined) args.maxPieceCount = maxPieceCount;
  if (searchTerm) args.searchTerm = searchTerm;
  if (puzzleId) args.puzzleId = puzzleId;
  // Only when narrowing: an empty list means "any way", the server's default.
  if (query.availability.length > 0) args.availability = query.availability;
  return args;
}

interface PageData<Row> {
  ownedPuzzles: Row[];
  total: number;
  hasMore: boolean;
}

/** Joins the requested pages in order, up to the first one still loading (so no gap opens), and
 *  drops a row a later page repeats (an offer added meanwhile shifts the offsets). */
export function mergeBrowsePages<Row extends { _id: string }>(
  pages: ReadonlyArray<PageData<Row> | undefined>,
) {
  const rows: Row[] = [];
  const seen = new Set<string>();
  let loaded = 0;
  let last: PageData<Row> | undefined;
  for (const page of pages) {
    if (!page) break;
    loaded += 1;
    last = page;
    for (const row of page.ownedPuzzles) {
      if (seen.has(row._id)) continue;
      seen.add(row._id);
      rows.push(row);
    }
  }
  return {
    rows,
    total: last?.total,
    // More can be asked for once every requested page is in and the last one says there is more.
    hasMore: loaded === pages.length && (last?.hasMore ?? false),
    loadingMore: loaded > 0 && loaded < pages.length,
  };
}

/** Browse results for these filters, a page at a time. A filter change starts again at one page. */
export function useBrowsePages(args: BrowseArgs) {
  const key = JSON.stringify(args);
  // The page count belongs to one set of filters: under other filters it reads as 1, without an
  // effect to reset it. A return visit starts with as many pages as were open last time.
  const [pages, setPages] = useState(() => ({
    key,
    count: openPages.get(key) ?? 1,
  }));
  const pageCount = pages.key === key ? pages.count : 1;
  const pageQuery = (index: number) =>
    convexQuery(gateway.library.browseOwned, {
      ...args,
      offset: index * BROWSE_PAGE_SIZE,
      limit: BROWSE_PAGE_SIZE,
    });

  // The first page keeps the previous filters' rows on screen while the new ones load, so the
  // results don't blank out on every change.
  const first = useQuery({
    ...pageQuery(0),
    placeholderData: keepPreviousData,
  });
  const rest = useQueries({
    queries: Array.from({ length: pageCount - 1 }, (_, i) => pageQuery(i + 1)),
  });

  // A later page that failed: the rows before it stay, and Load more asks for it again. While it
  // does, it reads as loading.
  const failedIndex = rest.findIndex(
    (r) => r.data === undefined && r.error !== null && !r.isFetching,
  );
  const reachable = failedIndex === -1 ? rest : rest.slice(0, failedIndex);

  const stale = first.isPlaceholderData;
  const merged = mergeBrowsePages([
    first.data,
    ...reachable.map((r) => r.data),
  ]);
  return {
    rows: merged.rows,
    total: merged.total,
    hasMore: merged.hasMore && !stale,
    loadingMore: merged.loadingMore,
    /** Nothing to show yet: the first page of a first visit is on its way. */
    loading: first.data === undefined && first.error === null,
    /** The rows on screen belong to the previous filters; the new ones are on their way. */
    stale,
    failed: first.error !== null && first.data === undefined,
    /** The page Load more asked for failed; the button asks for it again. */
    loadMoreFailed: failedIndex !== -1,
    loadMore: () => {
      if (failedIndex !== -1) {
        void rest[failedIndex].refetch();
        return;
      }
      openPages.set(key, pageCount + 1);
      setPages({ key, count: pageCount + 1 });
    },
  };
}
