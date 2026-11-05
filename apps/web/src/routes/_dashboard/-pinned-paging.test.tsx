// @vitest-environment happy-dom
// The "-" prefix keeps the TanStack route generator from treating this file as a route.
import { gateway } from "@/gateway";
import { act, renderHook } from "@testing-library/react";
import { usePaginatedQuery } from "convex-helpers/react";
import { ConvexProvider, type ConvexReactClient } from "convex/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it } from "vitest";

// PERF-B13: what People, Exchanges and the member review list rely on from their paging hook. Their
// reads go through stream(), so a page only keeps its end if the client pins it: asking for more must
// pin the current last page to where the next one starts, and a pinned page that grows must not move
// that boundary. packages/backend/convex/pinnedPageBoundaries.test.ts covers the server's half.

type Opts = { numItems: number; cursor: string | null; endCursor?: string };

// The shape stream().paginate() answers with, over rows that double as their own cursors.
const pageOf = (rows: string[], { numItems, cursor, endCursor }: Opts) => {
  const start = cursor === null ? 0 : rows.indexOf(cursor) + 1;
  if (endCursor) {
    const pinned = rows.slice(start, rows.indexOf(endCursor) + 1);
    // The server's bound on a pinned page (clampPaginationOpts): it stops reading and asks for a
    // split, and the page still ends at its pin (keepPinnedEnd).
    if (pinned.length > pinnedBound) {
      const read = pinned.slice(0, pinnedBound);
      return {
        page: read,
        isDone: false,
        continueCursor: endCursor,
        pageStatus: "SplitRequired",
        splitCursor: read[Math.floor((read.length - 1) / 2)],
      };
    }
    return { page: pinned, isDone: false, continueCursor: endCursor };
  }
  const page = rows.slice(start, start + numItems);
  const isDone = start + numItems >= rows.length;
  return {
    page,
    isDone,
    continueCursor: isDone ? "[]" : (page.at(-1) ?? "[]"),
  };
};

// A Convex client that answers from `rows` at once and keeps track of what is subscribed.
let rows: string[];
let pinnedBound: number;
let subscribed: Map<() => void, Opts>;
const client = {
  logger: console,
  watchQuery: (_query: unknown, args: { paginationOpts: Opts }) => ({
    onUpdate: (callback: () => void) => {
      subscribed.set(callback, args.paginationOpts);
      return () => subscribed.delete(callback);
    },
    localQueryResult: () => pageOf(rows, args.paginationOpts),
    journal: () => undefined,
  }),
} as unknown as ConvexReactClient;

const wrapper = ({ children }: { children: ReactNode }) => (
  <ConvexProvider client={client}>{children}</ConvexProvider>
);

const list = () =>
  renderHook(
    () =>
      usePaginatedQuery(gateway.social.myNetwork, {}, { initialNumItems: 2 }),
    { wrapper },
  );

// The data changed: every subscription answers again.
const write = (next: string[]) =>
  act(() => {
    rows = next;
    for (const update of subscribed.keys()) update();
  });

beforeEach(() => {
  rows = ["e", "d", "c", "b", "a"];
  pinnedBound = Number.POSITIVE_INFINITY;
  subscribed = new Map();
});

describe("the paging hook behind the stream-backed lists", () => {
  it("doesn't pin a first page while nothing follows it", () => {
    const { result } = list();
    expect(result.current.status).toBe("CanLoadMore");
    expect([...subscribed.values()]).toEqual([{ numItems: 2, cursor: null }]);
  });

  it("pins a page to where the next one starts when asked for more", () => {
    const { result } = list();
    act(() => result.current.loadMore(2));
    expect([...subscribed.values()]).toEqual(
      expect.arrayContaining([
        { numItems: 2, cursor: null, endCursor: "d" },
        { numItems: 2, cursor: "d" },
      ]),
    );
    expect(result.current.results).toEqual(["e", "d", "c", "b"]);
  });

  it("keeps the boundary when a row joins the pinned page", () => {
    const { result } = list();
    act(() => result.current.loadMore(2));
    write(["f", ...rows]);
    expect(result.current.results).toEqual(["f", "e", "d", "c", "b"]);
  });

  it("doesn't list a row twice when one leaves the pinned page", () => {
    const { result } = list();
    act(() => result.current.loadMore(2));
    write(rows.filter((row) => row !== "e"));
    expect(result.current.results).toEqual(["d", "c", "b"]);
  });

  it("splits a pinned page the server bounded and keeps every row", () => {
    pinnedBound = 2;
    const { result } = list();
    act(() => result.current.loadMore(2));
    write(["h", "g", "f", ...rows]);
    expect(result.current.results).toEqual(["h", "g", "f", "e", "d", "c", "b"]);
  });
});
