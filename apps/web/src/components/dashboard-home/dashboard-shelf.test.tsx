// @vitest-environment happy-dom
import { gateway, type Id } from "@/gateway";
import { convexQuery, ConvexQueryClient } from "@convex-dev/react-query";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, within } from "@testing-library/react";
import { ConvexReactClient } from "convex/react";
import { getFunctionName, type FunctionReturnType } from "convex/server";
import type { ReactNode } from "react";
import { IntlProvider } from "use-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import en from "../../../locales/en.json";
import { FreshSection } from "./fresh-section";
import { MY_SHELF_SIZE, ShelfSection } from "./shelf-section";

// The dashboard Shelf and Fresh sections read the member's own shelf summary (library.myShelf):
// counts come from the server over the whole library, only the newest copies are joined, both
// sections share one subscription, and neither subscribes to the whole library (PERF-B5q).

vi.mock("@/compat/link", () => ({
  Link: ({ href, children }: { href: string; children?: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

// The stat rows use the router's Link directly (a row's hash, /profile#reviews).
vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  Link: ({ to, children }: { to: string; children?: ReactNode }) => (
    <a href={to}>{children}</a>
  ),
}));

vi.mock("@/components/dashboard-home/use-current-member", () => ({
  useCurrentMember: () => ({ member: { _id: "me" }, isMemberLoading: false }),
}));

// The WebGL plank is out of scope here: render the box titles it was handed.
vi.mock("@/components/common/puzzle-plank-3d", () => ({
  PuzzlePlank3D: ({ boxes }: { boxes: { title?: string }[] }) => (
    <ul aria-label="plank">
      {boxes.map((box, i) => (
        <li key={i}>{box.title}</li>
      ))}
    </ul>
  ),
}));

vi.mock("@/components/ui/puzzle-card", () => ({
  PuzzleViewProvider: ({ children }: { children: ReactNode }) => children,
  PuzzleCard: ({
    puzzle,
  }: {
    puzzle: { puzzle: { title: string } | null };
  }) => <article>{puzzle.puzzle?.title}</article>,
}));

type Shelf = FunctionReturnType<typeof gateway.library.myShelf>;
type Copy = Shelf["recent"][number];

const copy = (n: number): Copy => ({
  _id: `copy_${n}`,
  puzzleId: `puzzle_${n}`,
  ownerId: "me",
  condition: "good",
  availability: { forTrade: false, forSale: false, forLend: false },
  createdAt: 100 - n,
  updatedAt: 100 - n,
  puzzle: {
    _id: `puzzle_${n}`,
    title: `Puzzle ${n}`,
    pieceCount: 1000,
    createdAt: 0,
    updatedAt: 0,
  },
  coverUrl: null,
});

const shelfOf = (total: number, forTrade: number, recent: number): Shelf => ({
  total,
  forTrade,
  recent: Array.from({ length: recent }, (_, i) => copy(i + 1)),
});

const renderSections = (ui: ReactNode, shelf: Shelf) => {
  const convexQueryClient = new ConvexQueryClient(
    new ConvexReactClient("https://example.convex.cloud"),
  );
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        queryKeyHashFn: convexQueryClient.hashFn(),
        staleTime: Infinity,
        retry: false,
        queryFn: () => new Promise<never>(() => {}),
      },
    },
  });
  const set = (key: readonly unknown[], data: unknown) =>
    queryClient.setQueryData(key, data);
  set(
    convexQuery(gateway.library.myShelf, { limit: MY_SHELF_SIZE }).queryKey,
    shelf,
  );
  set(
    convexQuery(gateway.identity.userStats, { userId: "me" as Id<"users"> })
      .queryKey,
    { tradesCompleted: 0, averageRating: 0, totalReviews: 0 },
  );
  set(convexQuery(gateway.exchange.myLive, {}).queryKey, []);
  render(
    <QueryClientProvider client={queryClient}>
      <IntlProvider locale="en" messages={en} timeZone="Europe/Amsterdam">
        {ui}
      </IntlProvider>
    </QueryClientProvider>,
  );
  // Every Convex function the sections subscribed to (key: ["convexQuery", name, args]).
  return queryClient
    .getQueryCache()
    .getAll()
    .map((query) => query.queryKey[1]);
};

const OWNED_BY_OWNER = getFunctionName(gateway.library.ownedByOwner);
const MY_SHELF = getFunctionName(gateway.library.myShelf);

afterEach(cleanup);

describe("ShelfSection", () => {
  it("shows the library-wide counts from the shelf and plants the newest five on the plank", () => {
    const subscribed = renderSections(<ShelfSection />, shelfOf(42, 7, 6));

    expect(screen.getByText("42 on the shelf · 7 up for trade")).toBeTruthy();
    const owned = screen.getByText("Puzzles Owned").closest("a");
    expect(owned?.textContent).toContain("42");
    expect(owned?.textContent).toContain("7 up for trade");
    const plank = screen.getByRole("list", { name: "plank" });
    expect(
      within(plank)
        .getAllByRole("listitem")
        .map((item) => item.textContent),
    ).toEqual(["Puzzle 1", "Puzzle 2", "Puzzle 3", "Puzzle 4", "Puzzle 5"]);

    expect(subscribed).toContain(MY_SHELF);
    expect(subscribed).not.toContain(OWNED_BY_OWNER);
  });

  it("invites the first puzzle on an empty shelf", () => {
    renderSections(<ShelfSection />, shelfOf(0, 0, 0));
    expect(
      screen.getByRole("link", { name: "Add Your First Puzzle" }),
    ).toBeTruthy();
    expect(screen.queryByRole("list", { name: "plank" })).toBeNull();
  });
});

describe("FreshSection", () => {
  it("lists the six newest copies, newest first", () => {
    const subscribed = renderSections(<FreshSection />, shelfOf(42, 7, 6));
    expect(
      screen.getAllByRole("article").map((card) => card.textContent),
    ).toEqual([
      "Puzzle 1",
      "Puzzle 2",
      "Puzzle 3",
      "Puzzle 4",
      "Puzzle 5",
      "Puzzle 6",
    ]);
    expect(subscribed).not.toContain(OWNED_BY_OWNER);
  });

  it("renders nothing for an empty library", () => {
    renderSections(<FreshSection />, shelfOf(0, 0, 0));
    expect(screen.queryByText("Fresh on the Shelf")).toBeNull();
  });
});

describe("the dashboard shelf sections together", () => {
  it("share one shelf subscription and never read the whole library", () => {
    const subscribed = renderSections(
      <>
        <ShelfSection />
        <FreshSection />
      </>,
      shelfOf(9, 2, 6),
    );
    expect(subscribed.filter((name) => name === MY_SHELF)).toHaveLength(1);
    expect(subscribed).not.toContain(OWNED_BY_OWNER);
  });
});
