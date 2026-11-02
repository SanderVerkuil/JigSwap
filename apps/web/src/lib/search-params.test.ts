// @vitest-environment happy-dom
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
} from "@tanstack/react-router";
import { describe, expect, it } from "vitest";
import {
  browseEmptyState,
  browseFiltersFromSearch,
  validateBrowseSearch,
  type BrowseSearch,
} from "./browse-search";
import { catalogueSearchArgs } from "./catalogue-filters";
import {
  filtersFromSearch,
  validatePuzzlesSearch,
  type PuzzlesSearch,
} from "./puzzles-search";

// Through a real router, not the validators alone: the router merges a validator's result over the
// raw params, and a key the validator leaves out keeps its raw value in Route.useSearch().
const routerAt = <T>(
  href: string,
  validateSearch: (search: Record<string, unknown>) => T,
) => {
  const rootRoute = createRootRoute({ component: Outlet });
  const page = createRoute({
    getParentRoute: () => rootRoute,
    path: href.split("?")[0],
    validateSearch,
    component: () => null,
  });
  return createRouter({
    routeTree: rootRoute.addChildren([page]),
    history: createMemoryHistory({ initialEntries: [href] }),
  });
};

const searchAt = async <T>(
  href: string,
  validateSearch: (search: Record<string, unknown>) => T,
): Promise<T & Record<string, unknown>> => {
  const router = routerAt(href, validateSearch);
  await router.load();
  return router.state.matches.at(-1)?.search as T & Record<string, unknown>;
};

const puzzles = (query: string) =>
  searchAt<PuzzlesSearch>(`/puzzles?${query}`, validatePuzzlesSearch);
const browse = (query: string) =>
  searchAt<BrowseSearch>(`/browse?${query}`, validateBrowseSearch);

describe("/puzzles search params through the router", () => {
  it.each([
    ["q=2000", "q", "2000"],
    ["q=true", "q", "true"],
    ["brand=123", "brand", "123"],
    ["category=5", "category", "5"],
    ["tags=1", "tags", ["1"]],
    ["tags=[1,2]", "tags", ["1", "2"]],
    ["tags=[1,true,%22a%22]", "tags", ["1", "true", "a"]],
    ["minPieces=500", "minPieces", 500],
    ["fav=true", "fav", true],
    ["view=list", "view", "list"],
  ])("reads ?%s as a usable value", async (query, key, expected) => {
    expect((await puzzles(query))[key]).toEqual(expected);
  });

  it.each([
    ["q=null", "q"],
    ["q=[1]", "q"],
    ["q=%7B%22a%22:1%7D", "q"],
    ["brand=[1]", "brand"],
    ["category=%7B%22a%22:1%7D", "category"],
    ["tags=%7B%22a%22:1%7D", "tags"],
    ["minPieces=lots", "minPieces"],
    ["maxPieces=-1", "maxPieces"],
    ["maxPieces=1e999", "maxPieces"],
    ["minPieces=true", "minPieces"],
    ["difficulty=bogus", "difficulty"],
    ["difficulty=5", "difficulty"],
    ["fav=yes", "fav"],
    ["fav=false", "fav"],
    ["view=foo", "view"],
  ])("drops ?%s from Route.useSearch()", async (query, key) => {
    expect((await puzzles(query))[key]).toBeUndefined();
  });

  it.each([
    "q=2000",
    "q=true",
    "q=[1]",
    "brand=123",
    "category=5",
    "tags=1",
    "tags=[1,2]",
    "tags=%7B%22a%22:1%7D",
    "difficulty=bogus",
    "minPieces=lots",
    "view=foo",
    "utm_source=newsletter",
  ])("?%s gives filter values the page can use", async (query) => {
    const filters = filtersFromSearch(await puzzles(query));
    const { tags, ...text } = filters;
    for (const value of Object.values(text)) {
      expect(typeof value).toBe("string");
    }
    expect(Array.isArray(tags)).toBe(true);
    expect(() => catalogueSearchArgs(filters)).not.toThrow();
  });

  it("keeps the bare URL bare", async () => {
    const router = routerAt("/puzzles", validatePuzzlesSearch);
    await router.load();
    expect(router.state.location.href).toBe("/puzzles");
  });
});

describe("/browse search params through the router", () => {
  it.each([
    ["q=1000", "q", "1000"],
    ["q=true", "q", "true"],
    ["category=5", "category", "5"],
    ["puzzle=abc", "puzzle", "abc"],
    ["avail=forLend", "avail", ["forLend"]],
    ["condition=good", "condition", "good"],
    ["view=list", "view", "list"],
  ])("reads ?%s as a usable value", async (query, key, expected) => {
    expect((await browse(query))[key]).toEqual(expected);
  });

  it.each([
    ["q=null", "q"],
    ["q=[1]", "q"],
    // An id can't be a number, so unlike the text params this one isn't coerced.
    ["puzzle=42", "puzzle"],
    ["category=[1]", "category"],
    ["condition=bogus", "condition"],
    ["condition=5", "condition"],
    ["difficulty=bogus", "difficulty"],
    ["avail=foo", "avail"],
    ["avail=[1]", "avail"],
    ["minPieces=lots", "minPieces"],
    ["maxPieces=-5", "maxPieces"],
    ["view=foo", "view"],
  ])("drops ?%s from Route.useSearch()", async (query, key) => {
    expect((await browse(query))[key]).toBeUndefined();
  });

  it.each(["q=1000", "condition=bogus", "avail=foo", "category=5", "view=foo"])(
    "?%s gives filter values the page can use",
    async (query) => {
      const search = await browse(query);
      const { availability, ...text } = browseFiltersFromSearch(search);
      for (const value of Object.values(text)) {
        expect(typeof value).toBe("string");
      }
      expect(Array.isArray(availability)).toBe(true);
      expect(search.q === undefined || typeof search.q === "string").toBe(true);
    },
  );

  it("a stray param isn't a condition the member set", async () => {
    expect(
      browseEmptyState(await browse("puzzle=abc&utm_source=newsletter")),
    ).toBe("puzzleNotOffered");
    expect(browseEmptyState(await browse("utm_source=newsletter"))).toBe(
      "noOffers",
    );
    // Neither is a value that was dropped.
    expect(browseEmptyState(await browse("condition=bogus"))).toBe("noOffers");
    expect(browseEmptyState(await browse("view=foo"))).toBe("noOffers");
    expect(browseEmptyState(await browse("q=2000"))).toBe("filtered");
  });
});
