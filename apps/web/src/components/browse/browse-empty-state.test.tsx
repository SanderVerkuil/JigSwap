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
  Link: ({
    to,
    search,
    children,
  }: {
    to: string;
    search?: Record<string, string>;
    children?: ReactNode;
  }) => (
    <a href={search ? `${to}?${new URLSearchParams(search)}` : to}>
      {children}
    </a>
  ),
}));

const PUZZLE_ID = "puzzle_1";

const renderEmpty = ({
  search,
  puzzle = { _id: PUZZLE_ID, title: "Café" },
  locale = "en",
  onClearConditions = () => {},
}: {
  search: BrowseSearch;
  puzzle?: { _id: string; title: string } | null;
  locale?: "en" | "nl";
  onClearConditions?: () => void;
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
        <BrowseEmptyState
          search={search}
          onClearConditions={onClearConditions}
        />
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
  it("blames the filters and clears them when the text or a filter is set", () => {
    const onClearConditions = vi.fn();
    renderEmpty({
      search: { puzzle: PUZZLE_ID, q: "zzz" },
      onClearConditions,
    });
    expect(screen.getByText("No copies match these filters")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Clear All" }));
    expect(onClearConditions).toHaveBeenCalledOnce();
    expect(screen.queryByText("Nobody offers this puzzle yet")).toBeNull();
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
});
