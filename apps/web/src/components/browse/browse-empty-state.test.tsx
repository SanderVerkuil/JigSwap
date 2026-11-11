// @vitest-environment happy-dom
import { gateway, type Id } from "@/gateway";
import type { BrowseSearch } from "@/lib/browse-search";
import { convexQuery } from "@convex-dev/react-query";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { IntlProvider } from "use-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import en from "../../../locales/en.json";
import nl from "../../../locales/nl.json";
import { BrowseEmptyState } from "./browse-empty-state";

const favorites = vi.hoisted(() => ({
  favorited: false,
  toggleFavorite: vi.fn(),
}));
vi.mock("@/hooks/use-favorites", () => ({
  useFavorites: () => ({
    isLoading: false,
    isFavorite: () => favorites.favorited,
    toggleFavorite: favorites.toggleFavorite,
  }),
}));
vi.mock("@tanstack/react-router", () => ({
  // Like the router, leaves a param that is undefined out of the URL.
  Link: ({
    to,
    search,
    children,
  }: {
    to: string;
    search?: Record<string, string | undefined>;
    children?: ReactNode;
  }) => {
    const params = new URLSearchParams(
      Object.entries(search ?? {}).filter(
        (entry): entry is [string, string] => entry[1] !== undefined,
      ),
    ).toString();
    return <a href={params ? `${to}?${params}` : to}>{children}</a>;
  },
}));

const PUZZLE_ID = "puzzle_1";

const renderEmpty = ({
  search,
  puzzle = { _id: PUZZLE_ID, title: "Café" },
  locale = "en",
}: {
  search: BrowseSearch;
  puzzle?: { _id: string; title: string } | null;
  locale?: "en" | "nl";
}) => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, queryFn: () => new Promise<never>(() => {}) },
    },
  });
  queryClient.setQueryData(
    convexQuery(gateway.catalog.puzzleById, {
      puzzleId: PUZZLE_ID as Id<"puzzles">,
    }).queryKey,
    puzzle,
  );
  return render(
    <QueryClientProvider client={queryClient}>
      <IntlProvider
        locale={locale}
        messages={locale === "en" ? en : nl}
        timeZone="Europe/Amsterdam"
      >
        <BrowseEmptyState search={search} />
      </IntlProvider>
    </QueryClientProvider>,
  );
};

beforeEach(() => {
  favorites.favorited = false;
  favorites.toggleFavorite.mockReset();
});
afterEach(cleanup);

describe("BrowseEmptyState", () => {
  // The toolbar's Clear All is on screen whenever text or a filter is set: none is repeated here.
  it("names a plain search, and takes it on to the catalogue", () => {
    renderEmpty({ search: { q: "Dolomites" } });
    const title = screen.getByText(
      "Nobody offers a copy matching “Dolomites” right now",
    );
    // The member's text may be one long word: it wraps inside the column instead of overflowing.
    expect(title.closest(".wrap-anywhere")).not.toBeNull();
    expect(screen.queryByText("No copies match these filters")).toBeNull();
    expect(
      screen
        .getByRole("link", { name: "Open the catalogue" })
        .getAttribute("href"),
    ).toBe("/puzzles?q=Dolomites");
    expect(screen.queryByRole("button")).toBeNull();
  });

  // Only that puzzle's copies were searched, so "nobody offers a match" would be untrue.
  it("blames the filters for text within one puzzle's copies", () => {
    renderEmpty({ search: { puzzle: PUZZLE_ID, q: "Dolomites" } });
    expect(screen.getByText("No copies match these filters")).toBeTruthy();
    expect(
      screen.queryByText("Nobody offers a copy matching “Dolomites” right now"),
    ).toBeNull();
    expect(screen.queryByText("Nobody offers this puzzle yet")).toBeNull();
    expect(
      screen
        .getByRole("link", { name: "Open the catalogue" })
        .getAttribute("href"),
    ).toBe("/puzzles?q=Dolomites");
  });

  it("blames the filters when one is set, offering the catalogue, with the text", () => {
    renderEmpty({ search: { q: "lake", condition: "good" } });
    expect(screen.getByText("No copies match these filters")).toBeTruthy();
    expect(
      screen
        .getByRole("link", { name: "Open the catalogue" })
        .getAttribute("href"),
    ).toBe("/puzzles?q=lake");
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("offers the bare catalogue when only a filter is set", () => {
    renderEmpty({ search: { avail: ["forLend"] } });
    expect(
      screen
        .getByRole("link", { name: "Open the catalogue" })
        .getAttribute("href"),
    ).toBe("/puzzles");
  });

  it("says nobody offers the puzzle and lets the member favourite it", () => {
    renderEmpty({ search: { puzzle: PUZZLE_ID } });
    expect(screen.getByText("Nobody offers this puzzle yet")).toBeTruthy();
    expect(screen.queryByText("No copies match these filters")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Add to Favorites" }));
    expect(favorites.toggleFavorite).toHaveBeenCalledWith(PUZZLE_ID);
  });

  it("offers to remove the puzzle from favourites when it already is one", () => {
    favorites.favorited = true;
    renderEmpty({ search: { puzzle: PUZZLE_ID } });
    expect(
      screen.getByRole("button", { name: "Remove from Favorites" }),
    ).toBeTruthy();
  });

  it("offers no favourite for a puzzle that doesn't exist", () => {
    renderEmpty({ search: { puzzle: PUZZLE_ID }, puzzle: null });
    expect(screen.getByText("Nobody offers this puzzle yet")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("says nobody offers anything yet, pointing to the catalogue and to people", () => {
    renderEmpty({ search: { view: "list" } });
    expect(
      screen.getByText("No members are offering puzzles yet"),
    ).toBeTruthy();
    expect(
      screen
        .getByRole("link", { name: "Open the catalogue" })
        .getAttribute("href"),
    ).toBe("/puzzles");
    expect(
      screen.getByRole("link", { name: "Find people" }).getAttribute("href"),
    ).toBe("/people?tab=find");
  });

  it("speaks Dutch", () => {
    renderEmpty({ search: { puzzle: PUZZLE_ID }, locale: "nl" });
    expect(screen.getByText("Nog niemand biedt deze puzzel aan")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Toevoegen aan favorieten" }),
    ).toBeTruthy();
  });

  it("names a plain search in Dutch", () => {
    renderEmpty({ search: { q: "Dolomieten" }, locale: "nl" });
    expect(
      screen.getByText(
        "Niemand biedt nu een exemplaar aan dat past bij “Dolomieten”",
      ),
    ).toBeTruthy();
    expect(
      screen.getByRole("link", { name: "Naar de catalogus" }),
    ).toBeTruthy();
  });
});
