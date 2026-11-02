// @vitest-environment happy-dom
import { gateway } from "@/gateway";
import {
  validatePuzzlesSearch,
  type PuzzlesSearch,
} from "@/lib/puzzles-search";
import { convexQuery } from "@convex-dev/react-query";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { IntlProvider } from "use-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import en from "../../../locales/en.json";
import { PuzzlesClient } from "./puzzle-client";

// What the catalogue read reports. Mutable per test; `results` keep their identity between renders,
// as usePaginatedQuery's do.
type Paginated = {
  results: { _id: string; title: string }[];
  status: "LoadingFirstPage" | "CanLoadMore" | "LoadingMore" | "Exhausted";
};
const paginated = vi.hoisted(() => ({
  current: undefined as unknown as Paginated,
  lastArgs: undefined as unknown,
  loadMore: undefined as unknown as (numItems: number) => void,
}));

vi.mock("convex/react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("convex/react")>()),
  usePaginatedQuery: (_query: unknown, args: unknown) => {
    paginated.lastArgs = args;
    return { ...paginated.current, loadMore: paginated.loadMore };
  },
}));
vi.mock("@/components/dashboard-layout/page-header-slot", () => ({
  usePageHeaderActions: () => {},
}));
vi.mock("@/compat/link", () => ({
  Link: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock("./puzzle-card", () => ({
  PuzzleCard: ({ puzzle }: { puzzle: { title: string } }) => (
    <div data-testid="card">{puzzle.title}</div>
  ),
}));
vi.mock("./puzzle-card-skeleton", () => ({
  PuzzleCardSkeleton: () => <div data-testid="placeholder" />,
}));

const favouritesKey = convexQuery(gateway.catalog.listMyFavorites, {}).queryKey;

const LOADING: Paginated = { results: [], status: "LoadingFirstPage" };
const NOTHING: Paginated = { results: [], status: "Exhausted" };
const NONE_YET: Paginated = { results: [], status: "CanLoadMore" };
const row = (id: string, title = id) => ({ _id: id, title });
const LAKES = [row("lake-1", "Lake"), row("lake-2", "Lake view")];

// Stands in for the router: the URL state, always passed back through the route's validator.
function Harness({ initial }: { initial: PuzzlesSearch }) {
  const [search, setSearch] = useState(initial);
  return (
    <>
      <PuzzlesClient
        search={search}
        onSearchChange={(update) =>
          setSearch((prev) => validatePuzzlesSearch(update(prev)))
        }
      />
      <output data-testid="url">{JSON.stringify(search)}</output>
    </>
  );
}

const renderClient = (
  initial: PuzzlesSearch = {},
  { favourites }: { favourites?: unknown[] } = {},
) => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, queryFn: () => new Promise<never>(() => {}) },
    },
  });
  if (favourites) queryClient.setQueryData(favouritesKey, favourites);
  return render(
    <QueryClientProvider client={queryClient}>
      <IntlProvider locale="en" messages={en} timeZone="Europe/Amsterdam">
        <Harness initial={initial} />
      </IntlProvider>
    </QueryClientProvider>,
  );
};

const copy = en.puzzles.puzzles;
const url = () =>
  JSON.parse(screen.getByTestId("url").textContent) as PuzzlesSearch;
const placeholders = () => screen.queryAllByTestId("placeholder").length;
const cards = () => screen.queryAllByTestId("card").map((c) => c.textContent);
const filtersToggle = () =>
  screen.getByRole("button", { name: copy.filtersLabel });

beforeEach(() => {
  paginated.current = LOADING;
  paginated.lastArgs = undefined;
  paginated.loadMore = vi.fn();
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("PuzzlesClient results", () => {
  it("shows placeholders and no count or empty state while the first page loads", () => {
    renderClient();
    expect(placeholders()).toBeGreaterThan(0);
    expect(screen.queryByText(/puzzles? found/)).toBeNull();
    expect(screen.queryByText(copy.noPuzzlesFound)).toBeNull();
    expect(screen.queryByText(copy.emptyCatalogueTitle)).toBeNull();
  });

  it("keeps looking while later pages can still hold a match", () => {
    paginated.current = NONE_YET;
    renderClient({ q: "lake" });
    expect(placeholders()).toBeGreaterThan(0);
    expect(screen.getByText("0 puzzles found so far")).toBeTruthy();
    expect(screen.queryByText(copy.noPuzzlesFound)).toBeNull();
  });

  it("says nothing matched only once the search is exhausted, with a way to clear", () => {
    paginated.current = NOTHING;
    renderClient({ q: "lake", view: "list" });
    expect(screen.getByText(copy.noPuzzlesFound)).toBeTruthy();
    expect(screen.getByText("0 puzzles found")).toBeTruthy();
    expect(placeholders()).toBe(0);

    // Two ways to clear: the toolbar's and the empty state's. The view mode survives both.
    fireEvent.click(
      screen.getAllByRole("button", { name: copy.clearFilters })[1],
    );
    expect(url()).toEqual({ view: "list" });
  });

  it("blames a filter that is set, not only a term", () => {
    paginated.current = NOTHING;
    renderClient({ brand: "Jumbo" });
    expect(screen.getByText(copy.noPuzzlesFound)).toBeTruthy();
  });

  it("says the catalogue itself is empty when nothing narrows it", () => {
    paginated.current = NOTHING;
    renderClient();
    expect(screen.getByText(copy.emptyCatalogueTitle)).toBeTruthy();
    expect(screen.queryByText(copy.noPuzzlesFound)).toBeNull();
    expect(
      screen.queryByRole("button", { name: copy.clearFilters }),
    ).toBeNull();
  });

  it("shows one final count once every match is in", () => {
    paginated.current = { results: LAKES, status: "Exhausted" };
    renderClient();
    expect(cards()).toEqual(["Lake", "Lake view"]);
    expect(screen.getAllByText(/puzzles? found/)).toHaveLength(1);
    expect(screen.getByText("2 puzzles found")).toBeTruthy();
  });

  it("marks the count as partial while more can load", () => {
    paginated.current = { results: LAKES, status: "CanLoadMore" };
    renderClient();
    expect(screen.getByText("2 puzzles found so far")).toBeTruthy();
  });

  it("sends the term and every facet to the server search", () => {
    renderClient({
      q: "Lake",
      brand: "Jumbo",
      minPieces: 500,
      maxPieces: 1000,
      difficulty: "hard",
      category: "cat-1",
      tags: ["water"],
    });
    expect(paginated.lastArgs).toEqual({
      searchTerm: "lake",
      brand: "Jumbo",
      pieceMin: 500,
      pieceMax: 1000,
      difficulty: "hard",
      category: "cat-1",
      tags: ["water"],
    });
  });
});

describe("PuzzlesClient favourites", () => {
  const favourite = (id: string, title: string, brand: string) => ({
    _id: id,
    title,
    brand,
    pieceCount: 1000,
    status: "approved",
  });

  it("reads the favourites list instead of the search", () => {
    renderClient(
      { fav: true },
      { favourites: [favourite("f1", "Harbour", "Jumbo")] },
    );
    expect(paginated.lastArgs).toBe("skip");
    expect(cards()).toEqual(["Harbour"]);
    expect(screen.getByText("1 puzzle found")).toBeTruthy();
  });

  it("applies the same facets to the favourites on the client", () => {
    renderClient(
      { fav: true, brand: "Jumbo" },
      {
        favourites: [
          favourite("f1", "Harbour", "Jumbo"),
          favourite("f2", "Castle", "Ravensburger"),
        ],
      },
    );
    expect(cards()).toEqual(["Harbour"]);
  });

  it("offers the way back to the catalogue when there are no favourites", () => {
    renderClient({ fav: true }, { favourites: [] });
    expect(screen.getByText(copy.noFavoritesTitle)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: copy.showAllPuzzles }));
    expect(url().fav).toBeUndefined();
  });

  it("toggles through the URL and reports its state", () => {
    paginated.current = NOTHING;
    renderClient();
    const toggle = screen.getByRole("button", { name: copy.favoritesOnly });
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(toggle);
    expect(url().fav).toBe(true);
    expect(
      screen
        .getByRole("button", { name: copy.favoritesOnly })
        .getAttribute("aria-pressed"),
    ).toBe("true");
  });
});

describe("PuzzlesClient filters panel", () => {
  // After Back or from a shared link the results are narrowed: the member can see by what.
  it.each<[PuzzlesSearch]>([
    [{ brand: "Jumbo" }],
    [{ minPieces: 500 }],
    [{ maxPieces: 500 }],
    [{ difficulty: "easy" }],
    [{ category: "cat-1" }],
    [{ tags: ["water"] }],
  ])("starts open when %j narrows the results", (search) => {
    renderClient(search);
    expect(filtersToggle().getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("combobox", { name: "Difficulty" })).toBeTruthy();
  });

  // The term and the favourites toggle show themselves in the toolbar.
  it.each<[PuzzlesSearch]>([
    [{}],
    [{ q: "lake" }],
    [{ fav: true }],
    [{ view: "list" }],
  ])("starts closed for %j", (search) => {
    renderClient(search);
    expect(filtersToggle().getAttribute("aria-expanded")).toBe("false");
  });

  it("can still be closed while a facet is set", () => {
    renderClient({ brand: "Jumbo" });
    fireEvent.click(filtersToggle());
    expect(filtersToggle().getAttribute("aria-expanded")).toBe("false");
  });

  it("opens and closes from its toggle, whose aria-controls always resolves", () => {
    renderClient();
    const toggle = filtersToggle();
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    const panelId = toggle.getAttribute("aria-controls")!;
    expect(document.getElementById(panelId)).toBeTruthy();
    expect(screen.queryByRole("combobox", { name: "Difficulty" })).toBeNull();

    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("combobox", { name: "Difficulty" })).toBeTruthy();

    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
  });
});
