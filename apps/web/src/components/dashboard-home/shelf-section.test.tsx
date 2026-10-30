import { gateway, type Id } from "@/gateway";
import { convexQuery, ConvexQueryClient } from "@convex-dev/react-query";
import type { OwnedCopyView } from "@jigswap/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ConvexReactClient } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { parseFragment, type DefaultTreeAdapterMap } from "parse5";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { IntlProvider } from "use-intl";
import { describe, expect, it, vi } from "vitest";
import en from "../../../locales/en.json";
import { FreshSection } from "./fresh-section";
import {
  MY_SHELF_SIZE,
  shelfBoxCount,
  ShelfSection,
  statRowsFor,
} from "./shelf-section";

const ME = "me1" as Id<"users">;

// Router-free Link: the test asserts the rendered href, not routing.
vi.mock("@tanstack/react-router", () => ({
  Link: ({ to, children, ...rest }: { to: string; children?: ReactNode }) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("./use-current-member", () => ({
  useCurrentMember: () => ({ member: { _id: ME }, isMemberLoading: false }),
}));
// The 3D plank is not what these tests are about (and needs WebGL).
vi.mock("@/components/common/puzzle-plank-3d", () => ({
  PuzzlePlank3D: () => <div data-testid="plank" />,
}));
vi.mock("@/components/ui/puzzle-card", () => ({
  PuzzleCard: ({ puzzle }: { puzzle: OwnedCopyView }) => (
    <article data-copy={puzzle._id} />
  ),
  PuzzleViewProvider: ({ children }: { children: ReactNode }) => children,
}));

type Stats = NonNullable<FunctionReturnType<typeof gateway.identity.userStats>>;
type Exchanges = FunctionReturnType<typeof gateway.exchange.forUser>;

const copy = (i: number, forTrade = true): OwnedCopyView => ({
  _id: `copy-${i}`,
  puzzleId: `puzzle-${i}`,
  ownerId: ME,
  condition: "good",
  availability: { forTrade, forSale: false, forLend: false },
  snapshot: { title: `Puzzle ${i}`, pieceCount: 1000 },
  createdAt: i,
  updatedAt: i,
  puzzle: null,
});
const copies = (n: number) => Array.from({ length: n }, (_, i) => copy(i));

const noStats: Stats = {
  puzzlesOwned: 3,
  puzzlesAvailable: 3,
  tradesCompleted: 0,
  averageRating: 0,
  totalReviews: 0,
};

const render = (
  node: ReactNode,
  data: { copies: OwnedCopyView[]; stats?: Stats; exchanges?: Exchanges },
) => {
  // No network: SSR never runs effects, so queries only read the seeded cache.
  const convex = new ConvexReactClient("https://example.convex.cloud");
  const convexQueryClient = new ConvexQueryClient(convex);
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        queryKeyHashFn: convexQueryClient.hashFn(),
        queryFn: () => new Promise<never>(() => {}),
      },
    },
  });
  queryClient.setQueryData(
    convexQuery(gateway.library.myShelf, { limit: MY_SHELF_SIZE }).queryKey,
    {
      total: data.copies.length,
      forTrade: data.copies.filter((c) => c.availability.forTrade).length,
      recent: data.copies.slice(0, MY_SHELF_SIZE),
    },
  );
  queryClient.setQueryData(
    convexQuery(gateway.identity.userStats, { userId: ME }).queryKey,
    data.stats ?? noStats,
  );
  queryClient.setQueryData(
    convexQuery(gateway.exchange.forUser, {}).queryKey,
    data.exchanges ?? [],
  );
  return renderToStaticMarkup(
    <QueryClientProvider client={queryClient}>
      <IntlProvider locale="en" messages={en} timeZone="Europe/Amsterdam">
        {node}
      </IntlProvider>
    </QueryClientProvider>,
  );
};

type Element = DefaultTreeAdapterMap["element"];
type Node = DefaultTreeAdapterMap["childNode"];
const elements = (root: { childNodes: Node[] }): Element[] =>
  root.childNodes.flatMap((node) =>
    "tagName" in node ? [node, ...elements(node)] : [],
  );
const all = (html: string) => elements(parseFragment(html));
const attr = (el: Element, name: string) =>
  el.attrs.find((a) => a.name === name)?.value;
const text = (node: { childNodes?: Node[] }): string =>
  (node.childNodes ?? [])
    .map((child) =>
      child.nodeName === "#text"
        ? (child as DefaultTreeAdapterMap["textNode"]).value
        : text(child as Element),
    )
    .join("");

// The stat rows: [href, text] of each link inside the stats rail.
const statRail = (html: string) =>
  all(html).find((el) => attr(el, "data-testid") === "shelf-stats");
const statRows = (html: string) =>
  elements(statRail(html) ?? { childNodes: [] })
    .filter((el) => el.tagName === "a")
    .map((a) => [attr(a, "href"), text(a)]);

describe("statRowsFor", () => {
  it("shows only the owned count while there is nothing else to count", () => {
    expect(
      statRowsFor({ tradesCompleted: 0, totalReviews: 0, activeExchanges: 0 }),
    ).toEqual(["owned"]);
  });

  it("shows all four once any exchange or review exists", () => {
    const four = ["owned", "completed", "rating", "active"];
    expect(
      statRowsFor({ tradesCompleted: 1, totalReviews: 0, activeExchanges: 0 }),
    ).toEqual(four);
    expect(
      statRowsFor({ tradesCompleted: 0, totalReviews: 1, activeExchanges: 0 }),
    ).toEqual(four);
    expect(
      statRowsFor({ tradesCompleted: 0, totalReviews: 0, activeExchanges: 2 }),
    ).toEqual(four);
  });
});

describe("ShelfSection — stats", () => {
  it("renders one stat row for a new member, not three zeros", () => {
    const html = render(<ShelfSection />, { copies: copies(3) });
    const rows = statRows(html);
    expect(rows).toHaveLength(1);
    expect(rows[0][0]).toBe("/my-puzzles");
    expect(rows[0][1]).toContain(en.dashboard.shelf.stats.ownedLabel);
  });

  it("lays four rows out as a compact 2×2 grid below lg", () => {
    const html = render(<ShelfSection />, {
      copies: copies(3),
      stats: { ...noStats, tradesCompleted: 2 },
    });
    expect(statRows(html)).toHaveLength(4);
    const classes = attr(statRail(html)!, "class")?.split(" ") ?? [];
    expect(classes).toContain("grid-cols-2");
    expect(classes).toContain("lg:flex-col");
  });
});

describe("FreshSection", () => {
  it("stays hidden while every copy already sits on the shelf", () => {
    expect(render(<FreshSection />, { copies: copies(0) })).toBe("");
    expect(
      render(<FreshSection />, { copies: copies(shelfBoxCount(false)) }),
    ).toBe("");
  });

  it("shows the newest six once the library outgrows the shelf", () => {
    const html = render(<FreshSection />, {
      copies: copies(shelfBoxCount(false) + 3),
    });
    expect(all(html).filter((el) => el.tagName === "article")).toHaveLength(6);
  });

  it("matches the shelf's box count on each device", () => {
    expect(shelfBoxCount(false)).toBe(5);
    expect(shelfBoxCount(true)).toBe(4);
  });
});
