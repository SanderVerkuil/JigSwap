// @vitest-environment happy-dom
import { gateway } from "@/gateway";
import { convexQuery } from "@convex-dev/react-query";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { EMPTY_QUERY } from "./query-builder";
import {
  BROWSE_PAGE_SIZE,
  browseFilterArgs,
  mergeBrowsePages,
  useBrowsePages,
  type BrowseArgs,
} from "./use-browse-pages";

const rows = (from: number, to: number) =>
  Array.from({ length: to - from }, (_, i) => ({ _id: `copy-${from + i}` }));
const page = (ids: { _id: string }[], total: number, hasMore: boolean) => ({
  ownedPuzzles: ids,
  total,
  hasMore,
});
const idsOf = (list: { _id: string }[]) => list.map((row) => row._id);

describe("mergeBrowsePages", () => {
  it("joins pages in order and drops a row a later page repeats", () => {
    const merged = mergeBrowsePages([
      page(rows(0, 3), 5, true),
      page([{ _id: "copy-2" }, ...rows(3, 5)], 5, false),
    ]);
    expect(idsOf(merged.rows)).toEqual([
      "copy-0",
      "copy-1",
      "copy-2",
      "copy-3",
      "copy-4",
    ]);
    expect(merged.total).toBe(5);
    expect(merged.hasMore).toBe(false);
    expect(merged.loadingMore).toBe(false);
  });

  it("stops at the first page still loading, so no gap opens", () => {
    const merged = mergeBrowsePages([
      page(rows(0, 2), 6, true),
      undefined,
      page(rows(4, 6), 6, false),
    ]);
    expect(idsOf(merged.rows)).toEqual(["copy-0", "copy-1"]);
    expect(merged.loadingMore).toBe(true);
    // Nothing more can be asked for until the requested pages are in.
    expect(merged.hasMore).toBe(false);
  });

  it("offers more only when the last requested page says so", () => {
    expect(mergeBrowsePages([page(rows(0, 2), 4, true)]).hasMore).toBe(true);
    expect(mergeBrowsePages([page(rows(0, 2), 2, false)]).hasMore).toBe(false);
  });

  it("has no rows and no total before the first page arrives", () => {
    const merged = mergeBrowsePages([undefined]);
    expect(merged.rows).toEqual([]);
    expect(merged.total).toBeUndefined();
    expect(merged.loadingMore).toBe(false);
  });
});

describe("browseFilterArgs", () => {
  const empty = EMPTY_QUERY;

  it("sends availability only when a channel is chosen", () => {
    expect(browseFilterArgs(empty, "", undefined)).not.toHaveProperty(
      "availability",
    );
    expect(
      browseFilterArgs(
        { ...empty, availability: ["forLend", "forSale"] },
        "",
        undefined,
      ).availability,
    ).toEqual(["forLend", "forSale"]);
  });

  it("maps the filters onto the browse arguments", () => {
    expect(
      browseFilterArgs(
        {
          ...empty,
          category: "cat-1",
          condition: "good",
          difficulty: "hard",
          minPieces: "500",
          maxPieces: "1000",
        },
        "harbour",
        "puzzle-1",
      ),
    ).toEqual({
      category: "cat-1",
      condition: "good",
      difficulty: "hard",
      minPieceCount: 500,
      maxPieceCount: 1000,
      searchTerm: "harbour",
      puzzleId: "puzzle-1",
      includeOwnPuzzles: false,
    });
  });

  it("leaves out empty and unreadable values", () => {
    expect(
      browseFilterArgs({ ...empty, minPieces: "abc" }, "", undefined),
    ).toEqual({ includeOwnPuzzles: false });
  });
});

describe("useBrowsePages", () => {
  afterEach(cleanup);

  const keyFor = (args: BrowseArgs, pageIndex: number) =>
    convexQuery(gateway.library.browseOwned, {
      ...args,
      offset: pageIndex * BROWSE_PAGE_SIZE,
      limit: BROWSE_PAGE_SIZE,
    }).queryKey;

  // Unseeded pages stay in flight, like a subscription that hasn't answered yet.
  const newClient = () =>
    new QueryClient({
      defaultOptions: {
        queries: { retry: false, queryFn: () => new Promise<never>(() => {}) },
      },
    });
  const mount = (queryClient: QueryClient, initial: BrowseArgs) =>
    renderHook(({ args }) => useBrowsePages(args), {
      initialProps: { args: initial },
      wrapper: ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={queryClient}>
          {children}
        </QueryClientProvider>
      ),
    });
  const setup = (initial: BrowseArgs) => {
    const queryClient = newClient();
    return { queryClient, hook: mount(queryClient, initial) };
  };

  // The open-page memory outlives a mount, so every test browses its own filters.
  const filters = (searchTerm: string): BrowseArgs => ({
    includeOwnPuzzles: false,
    searchTerm,
  });

  it("loads the next page on request and stops when the server has no more", async () => {
    const all = filters("paging");
    const total = BROWSE_PAGE_SIZE + 2;
    const { queryClient, hook } = setup(all);
    act(() => {
      queryClient.setQueryData(
        keyFor(all, 0),
        page(rows(0, BROWSE_PAGE_SIZE), total, true),
      );
    });
    await waitFor(() =>
      expect(hook.result.current.rows).toHaveLength(BROWSE_PAGE_SIZE),
    );
    expect(hook.result.current.total).toBe(total);
    expect(hook.result.current.hasMore).toBe(true);

    act(() => hook.result.current.loadMore());
    expect(hook.result.current.loadingMore).toBe(true);
    expect(queryClient.getQueryState(keyFor(all, 1))).toBeDefined();

    act(() => {
      queryClient.setQueryData(
        keyFor(all, 1),
        page(rows(BROWSE_PAGE_SIZE - 1, total), total, false),
      );
    });
    // The repeated row (the last of page 1, again first on page 2) is shown once.
    await waitFor(() => expect(hook.result.current.rows).toHaveLength(total));
    expect(hook.result.current.hasMore).toBe(false);
    expect(hook.result.current.loadingMore).toBe(false);
  });

  it("starts again from the first page when the filters change", async () => {
    const all = filters("reset");
    const lend: BrowseArgs = { ...all, availability: ["forLend"] };
    const { queryClient, hook } = setup(all);
    act(() => {
      queryClient.setQueryData(
        keyFor(all, 0),
        page(rows(0, BROWSE_PAGE_SIZE), 100, true),
      );
    });
    await waitFor(() => expect(hook.result.current.hasMore).toBe(true));
    act(() => hook.result.current.loadMore());
    expect(queryClient.getQueryState(keyFor(all, 1))).toBeDefined();

    hook.rerender({ args: lend });
    // The previous results stay on screen, marked stale, until the new first page arrives.
    expect(hook.result.current.stale).toBe(true);
    expect(hook.result.current.hasMore).toBe(false);
    expect(queryClient.getQueryState(keyFor(lend, 1))).toBeUndefined();

    act(() => {
      queryClient.setQueryData(keyFor(lend, 0), page(rows(0, 3), 3, false));
    });
    await waitFor(() => expect(hook.result.current.stale).toBe(false));
    expect(idsOf(hook.result.current.rows)).toEqual([
      "copy-0",
      "copy-1",
      "copy-2",
    ]);
    expect(hook.result.current.total).toBe(3);
  });

  it("reports loading until the first page of a first visit arrives", () => {
    const { hook } = setup(filters("first-visit"));
    expect(hook.result.current.loading).toBe(true);
    expect(hook.result.current.rows).toEqual([]);
  });

  it("comes back (after Back) with as many pages as were open", async () => {
    const args = filters("return-visit");
    const { queryClient, hook } = setup(args);
    act(() => {
      queryClient.setQueryData(
        keyFor(args, 0),
        page(rows(0, BROWSE_PAGE_SIZE), 60, true),
      );
      queryClient.setQueryData(
        keyFor(args, 1),
        page(rows(BROWSE_PAGE_SIZE, 60), 60, false),
      );
    });
    await waitFor(() => expect(hook.result.current.hasMore).toBe(true));
    act(() => hook.result.current.loadMore());
    await waitFor(() => expect(hook.result.current.rows).toHaveLength(60));
    hook.unmount();

    // A new mount with the same filters renders both pages straight from the cache.
    const again = mount(queryClient, args);
    expect(again.result.current.rows).toHaveLength(60);
    expect(again.result.current.hasMore).toBe(false);
  });
});
