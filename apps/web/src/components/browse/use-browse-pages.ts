"use client";

import { gateway } from "@/gateway";
import { convexQuery } from "@convex-dev/react-query";
import {
  keepPreviousData,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
// sanctioned convex/react exception: useConvex for the one-shot read of a later page, which must not
// open a subscription.
import { useConvex } from "convex/react";
import type { FunctionArgs, FunctionReturnType } from "convex/server";
import { useState } from "react";
import type { QueryBuilderState } from "./query-builder";

// Browse asks for other members' offers a page of this size at a time, each from where the last one
// stopped. The server must allow at least this many rows per call.
export const BROWSE_PAGE_SIZE = 48;

// How long a list that went past its first page is kept for coming back to it. Past this, Back opens
// the live first page again rather than listings this old.
const LOADED_LIST_KEPT_MS = 5 * 60 * 1000;

type BrowsePage = FunctionReturnType<typeof gateway.library.browseOwned>;
export type BrowseRow = BrowsePage["ownedPuzzles"][number];
/** Every Browse filter; the paging (cursor/limit) is added per page. */
export type BrowseArgs = Omit<
  FunctionArgs<typeof gateway.library.browseOwned>,
  "offset" | "limit" | "cursor"
>;

const pieceCount = (value: string): number | undefined => {
  const n = value.trim() === "" ? Number.NaN : Number(value);
  return Number.isFinite(n) ? n : undefined;
};

/** The builder's conditions as browse arguments. Every filter, availability included, runs on the
 *  server, so "Load more" covers all matching offers. Empty values are left out. */
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

/** A page's rows after the ones already there, without a row the list already holds. */
export function appendBrowseRows<Row extends { _id: string }>(
  rows: readonly Row[],
  page: readonly Row[],
): Row[] {
  const seen = new Set(rows.map((row) => row._id));
  return [...rows, ...page.filter((row) => !seen.has(row._id))];
}

// A list the member has taken past its first page. From that moment it is a snapshot: a live first
// page would shift under the pages after it, and a row pushed off its end by a new offer would belong
// to no page. A snapshot also subscribes to nothing, so only members still on a first page re-run
// when a listing changes.
interface LoadedList {
  key: string;
  rows: BrowseRow[];
  cursor: string | null;
  hasMore: boolean;
  status: "idle" | "loading" | "failed";
  loadedAt: number;
}

// What each set of filters had loaded when the member last left Browse. Coming Back shows it at once,
// so the page is as tall as before and the router's scroll restoration lands where the member was.
// In memory only: a reload starts afresh.
const loadedLists = new Map<string, LoadedList>();

const rememberedList = (key: string): LoadedList | null => {
  const kept = loadedLists.get(key);
  return kept && Date.now() - kept.loadedAt < LOADED_LIST_KEPT_MS
    ? { ...kept, status: "idle" }
    : null;
};

/** Browse results for these filters: the first page live, then a page at a time on request. A filter
 *  change starts again at a live first page. */
export function useBrowsePages(args: BrowseArgs) {
  const key = JSON.stringify(args);
  const convex = useConvex();
  const queryClient = useQueryClient();
  // The list belongs to one set of filters: under other filters it reads as none, without an effect
  // to reset it. A return visit starts with what was loaded last time.
  const [loaded, setLoaded] = useState(() => rememberedList(key));
  const list = loaded?.key === key ? loaded : null;

  const firstPage = {
    ...args,
    limit: BROWSE_PAGE_SIZE,
  };
  // The first page keeps the previous filters' rows on screen while the new ones load, so the
  // results don't blank out on every change.
  const first = useQuery({
    ...convexQuery(gateway.library.browseOwned, list ? "skip" : firstPage),
    placeholderData: keepPreviousData,
  });
  const stale = !list && first.isPlaceholderData;

  const loadMore = async () => {
    if (!list && (!first.data || stale)) return;
    const base: LoadedList = list ?? {
      key,
      rows: first.data?.ownedPuzzles ?? [],
      cursor: first.data?.continueCursor ?? null,
      hasMore: first.data?.hasMore ?? false,
      status: "idle",
      loadedAt: Date.now(),
    };
    const { cursor } = base;
    if (cursor === null || base.status === "loading") return;
    // Dropped from the cache now, because the live first page holds its subscription for as long as
    // it is cached (see router.tsx).
    if (!list) {
      queryClient.removeQueries({
        queryKey: convexQuery(gateway.library.browseOwned, firstPage).queryKey,
        exact: true,
      });
    }
    setLoaded({ ...base, status: "loading" });
    const settle = (next: LoadedList) => {
      // The filters may have changed meanwhile: then this only updates what Back would find.
      if (next.status === "idle") loadedLists.set(key, next);
      setLoaded((current) => (current?.key === key ? next : current));
    };
    try {
      const page = await convex.query(gateway.library.browseOwned, {
        ...firstPage,
        cursor,
      });
      settle({
        ...base,
        rows: appendBrowseRows(base.rows, page.ownedPuzzles),
        cursor: page.continueCursor,
        hasMore: page.hasMore,
        status: "idle",
        loadedAt: Date.now(),
      });
    } catch {
      settle({ ...base, status: "failed" });
    }
  };

  return {
    rows: list ? list.rows : (first.data?.ownedPuzzles ?? []),
    /** More may follow. A filter that matches little can say so with no rows on screen yet. */
    hasMore: list ? list.hasMore : (first.data?.hasMore ?? false) && !stale,
    loadingMore: list?.status === "loading",
    /** Nothing to show yet: the first page of a first visit is on its way. */
    loading: !list && first.data === undefined && first.error === null,
    /** The rows on screen belong to the previous filters; the new ones are on their way. */
    stale,
    failed: !list && first.error !== null && first.data === undefined,
    /** The page Load more asked for failed; the button asks for it again. */
    loadMoreFailed: list?.status === "failed",
    loadMore: () => void loadMore(),
  };
}
