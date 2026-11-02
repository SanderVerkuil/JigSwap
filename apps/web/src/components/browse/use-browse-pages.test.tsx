// @vitest-environment happy-dom
import { gateway } from "@/gateway";
import { convexQuery } from "@convex-dev/react-query";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EMPTY_QUERY } from "./query-builder";
import {
  appendBrowseRows,
  BROWSE_PAGE_SIZE,
  browseFilterArgs,
  useBrowsePages,
  type BrowseArgs,
} from "./use-browse-pages";

const convex = vi.hoisted(() => ({
  query: vi.fn<
    (
      fn: unknown,
      args: { cursor?: string | null },
    ) => Promise<{
      ownedPuzzles: { _id: string }[];
      hasMore: boolean;
      continueCursor: string | null;
    }>
  >(),
}));

vi.mock("convex/react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("convex/react")>()),
  useConvex: () => ({ query: convex.query }),
}));

const rows = (from: number, to: number) =>
  Array.from({ length: to - from }, (_, i) => ({ _id: `copy-${from + i}` }));
const page = (
  ids: { _id: string }[],
  hasMore: boolean,
  continueCursor: string | null,
) => ({ ownedPuzzles: ids, hasMore, continueCursor });
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
};
const idsOf = (list: { _id: string }[]) => list.map((row) => row._id);

describe("appendBrowseRows", () => {
  it("adds a page after the rows there, in its order", () => {
    expect(idsOf(appendBrowseRows(rows(0, 2), rows(2, 4)))).toEqual([
      "copy-0",
      "copy-1",
      "copy-2",
      "copy-3",
    ]);
  });

  it("drops a row the list already holds", () => {
    expect(idsOf(appendBrowseRows(rows(0, 2), rows(1, 3)))).toEqual([
      "copy-0",
      "copy-1",
      "copy-2",
    ]);
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
  beforeEach(() => {
    convex.query.mockReset();
    vi.useRealTimers();
  });

  const firstKey = (args: BrowseArgs) =>
    convexQuery(gateway.library.browseOwned, {
      ...args,
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
  const seedFirst = async (
    queryClient: QueryClient,
    args: BrowseArgs,
    value: ReturnType<typeof page>,
    hook?: { result: { current: { rows: unknown[] } } },
  ) => {
    act(() => {
      queryClient.setQueryData(firstKey(args), value);
    });
    if (hook) {
      await waitFor(() =>
        expect(hook.result.current.rows).toHaveLength(
          value.ownedPuzzles.length,
        ),
      );
    }
  };

  // The memory of loaded lists outlives a mount, so every test browses its own filters.
  const filters = (searchTerm: string): BrowseArgs => ({
    includeOwnPuzzles: false,
    searchTerm,
  });

  it("asks for the next page by cursor and stops when the server has no more", async () => {
    const all = filters("paging");
    const { queryClient, hook } = setup(all);
    await seedFirst(
      queryClient,
      all,
      page(rows(0, BROWSE_PAGE_SIZE), true, "after-first"),
      hook,
    );
    expect(hook.result.current.hasMore).toBe(true);
    expect(convex.query).not.toHaveBeenCalled();

    // A repeated row (the last of the list, again first on this page) is shown once.
    const next = deferred<ReturnType<typeof page>>();
    convex.query.mockReturnValueOnce(next.promise);
    act(() => hook.result.current.loadMore());
    expect(hook.result.current.loadingMore).toBe(true);
    expect(convex.query.mock.calls[0][1]).toEqual({
      ...all,
      limit: BROWSE_PAGE_SIZE,
      cursor: "after-first",
    });
    await act(async () => {
      next.resolve(
        page(rows(BROWSE_PAGE_SIZE - 1, BROWSE_PAGE_SIZE + 2), false, null),
      );
    });
    expect(hook.result.current.rows).toHaveLength(BROWSE_PAGE_SIZE + 2);
    expect(hook.result.current.hasMore).toBe(false);
    expect(hook.result.current.loadingMore).toBe(false);
  });

  it("holds one subscription at most: going past the first page drops it, and later pages open none", async () => {
    const all = filters("one-subscription");
    const { queryClient, hook } = setup(all);
    await seedFirst(queryClient, all, page(rows(0, 2), true, "c1"), hook);
    const convexQueries = () =>
      queryClient
        .getQueryCache()
        .getAll()
        .filter(
          (query) =>
            query.queryKey[0] === "convexQuery" && query.queryKey[2] !== "skip",
        );
    expect(convexQueries()).toHaveLength(1);

    convex.query.mockResolvedValueOnce(page(rows(2, 4), true, "c2"));
    await act(async () => hook.result.current.loadMore());
    expect(convexQueries()).toHaveLength(0);

    convex.query.mockResolvedValueOnce(page(rows(4, 6), false, null));
    await act(async () => hook.result.current.loadMore());
    expect(convexQueries()).toHaveLength(0);
    expect(hook.result.current.rows).toHaveLength(6);
    expect(convex.query.mock.calls.map((call) => call[1].cursor)).toEqual([
      "c1",
      "c2",
    ]);
  });

  it("keeps the first page live until Load more, and then a new offer can't shift the list", async () => {
    const all = filters("live-then-snapshot");
    const { queryClient, hook } = setup(all);
    await seedFirst(queryClient, all, page(rows(0, 2), true, "c1"), hook);

    // A new offer lands on top, while still on the first page.
    await seedFirst(
      queryClient,
      all,
      page([{ _id: "new" }, ...rows(0, 1)], true, "c0"),
    );
    await waitFor(() =>
      expect(idsOf(hook.result.current.rows)).toEqual(["new", "copy-0"]),
    );

    convex.query.mockResolvedValueOnce(page(rows(1, 3), false, null));
    await act(async () => hook.result.current.loadMore());
    // Asked from the cursor of the rows it holds, so nothing between them is lost.
    expect(convex.query.mock.calls[0][1].cursor).toBe("c0");
    expect(idsOf(hook.result.current.rows)).toEqual([
      "new",
      "copy-0",
      "copy-1",
      "copy-2",
    ]);
  });

  it("starts again from a live first page when the filters change", async () => {
    const all = filters("reset");
    const lend: BrowseArgs = { ...all, availability: ["forLend"] };
    const { queryClient, hook } = setup(all);
    await seedFirst(
      queryClient,
      all,
      page(rows(0, BROWSE_PAGE_SIZE), true, "c1"),
      hook,
    );
    convex.query.mockResolvedValueOnce(page(rows(48, 50), true, "c2"));
    await act(async () => hook.result.current.loadMore());
    expect(hook.result.current.rows).toHaveLength(50);

    hook.rerender({ args: lend });
    // The previous results stay on screen, marked stale, until the new first page arrives.
    expect(hook.result.current.stale).toBe(true);
    expect(hook.result.current.hasMore).toBe(false);
    expect(queryClient.getQueryState(firstKey(lend))).toBeDefined();

    await seedFirst(queryClient, lend, page(rows(0, 3), false, null));
    await waitFor(() => expect(hook.result.current.stale).toBe(false));
    expect(idsOf(hook.result.current.rows)).toEqual([
      "copy-0",
      "copy-1",
      "copy-2",
    ]);
  });

  it("doesn't take a page that arrives after the filters changed", async () => {
    const all = filters("late-page");
    const lend: BrowseArgs = { ...all, availability: ["forLend"] };
    const { queryClient, hook } = setup(all);
    await seedFirst(queryClient, all, page(rows(0, 2), true, "c1"), hook);
    const late = deferred<ReturnType<typeof page>>();
    convex.query.mockReturnValueOnce(late.promise);
    act(() => hook.result.current.loadMore());

    hook.rerender({ args: lend });
    await seedFirst(queryClient, lend, page([{ _id: "lend-1" }], false, null));
    await waitFor(() =>
      expect(idsOf(hook.result.current.rows)).toEqual(["lend-1"]),
    );

    await act(async () => late.resolve(page(rows(2, 4), false, null)));
    expect(idsOf(hook.result.current.rows)).toEqual(["lend-1"]);
    expect(hook.result.current.loadingMore).toBe(false);
  });

  it("reports loading until the first page of a first visit arrives", () => {
    const { hook } = setup(filters("first-visit"));
    expect(hook.result.current.loading).toBe(true);
    expect(hook.result.current.rows).toEqual([]);
  });

  it("offers more with no rows on screen when the server stopped looking early", async () => {
    const args = filters("short-page");
    const { queryClient, hook } = setup(args);
    await seedFirst(queryClient, args, page([], true, "c1"));
    await waitFor(() => expect(hook.result.current.hasMore).toBe(true));
    expect(hook.result.current.rows).toEqual([]);
    expect(hook.result.current.loading).toBe(false);
  });

  it("comes back (after Back) with what was loaded", async () => {
    const args = filters("return-visit");
    const { queryClient, hook } = setup(args);
    await seedFirst(
      queryClient,
      args,
      page(rows(0, BROWSE_PAGE_SIZE), true, "c1"),
      hook,
    );
    convex.query.mockResolvedValueOnce(
      page(rows(BROWSE_PAGE_SIZE, 60), false, null),
    );
    await act(async () => hook.result.current.loadMore());
    expect(hook.result.current.rows).toHaveLength(60);
    hook.unmount();

    // A new mount with the same filters renders both pages at once, and asks for nothing.
    const again = mount(queryClient, args);
    expect(again.result.current.rows).toHaveLength(60);
    expect(again.result.current.hasMore).toBe(false);
    expect(again.result.current.loading).toBe(false);
    expect(convex.query).toHaveBeenCalledTimes(1);
  });

  it("forgets a loaded list after a while, so Back opens the live first page", async () => {
    const args = filters("old-return-visit");
    const { queryClient, hook } = setup(args);
    await seedFirst(queryClient, args, page(rows(0, 2), true, "c1"), hook);
    convex.query.mockResolvedValueOnce(page(rows(2, 4), false, null));
    await act(async () => hook.result.current.loadMore());
    hook.unmount();

    const later = Date.now() + 6 * 60 * 1000;
    const now = vi.spyOn(Date, "now").mockReturnValue(later);
    const again = mount(newClient(), args);
    expect(again.result.current.rows).toEqual([]);
    expect(again.result.current.loading).toBe(true);
    now.mockRestore();
  });

  it("reports a later page that failed, keeps the rows and can ask for it again", async () => {
    const args = filters("later-page-fails");
    const { queryClient, hook } = setup(args);
    await seedFirst(
      queryClient,
      args,
      page(rows(0, BROWSE_PAGE_SIZE), true, "c1"),
      hook,
    );
    expect(hook.result.current.loadMoreFailed).toBe(false);

    convex.query.mockRejectedValueOnce(new Error("offline"));
    await act(async () => hook.result.current.loadMore());
    // Not stuck on "Loading…": the rows stay, and the button can be pressed again.
    expect(hook.result.current.loadMoreFailed).toBe(true);
    expect(hook.result.current.rows).toHaveLength(BROWSE_PAGE_SIZE);
    expect(hook.result.current.loadingMore).toBe(false);
    expect(hook.result.current.hasMore).toBe(true);
    expect(hook.result.current.failed).toBe(false);

    convex.query.mockResolvedValueOnce(
      page(rows(BROWSE_PAGE_SIZE, 50), false, null),
    );
    await act(async () => hook.result.current.loadMore());
    expect(hook.result.current.rows).toHaveLength(50);
    expect(hook.result.current.loadMoreFailed).toBe(false);
    expect(hook.result.current.hasMore).toBe(false);
    // The same page both times.
    expect(convex.query.mock.calls.map((call) => call[1].cursor)).toEqual([
      "c1",
      "c1",
    ]);
  });

  it("asks once for a page, however often the button is pressed meanwhile", async () => {
    const args = filters("double-press");
    const { queryClient, hook } = setup(args);
    await seedFirst(queryClient, args, page(rows(0, 2), true, "c1"), hook);
    const next = deferred<ReturnType<typeof page>>();
    convex.query.mockReturnValue(next.promise);

    act(() => hook.result.current.loadMore());
    act(() => hook.result.current.loadMore());
    expect(convex.query).toHaveBeenCalledTimes(1);

    await act(async () => next.resolve(page(rows(2, 3), false, null)));
  });
});
