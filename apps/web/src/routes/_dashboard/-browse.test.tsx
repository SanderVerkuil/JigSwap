// @vitest-environment happy-dom
// The "-" prefix keeps the TanStack route generator from treating this file as a route.
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { IntlProvider } from "use-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import en from "../../../locales/en.json";
import { Route as BrowseRoute } from "./browse";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

// The page's wiring is under test, on the real route with its real search validation: what
// useBrowsePages reports is set per test, and the member, categories and favourites reads are stubs.
const browse = vi.hoisted(() => ({
  current: {} as Record<string, unknown>,
  lastArgs: undefined as unknown,
}));
vi.mock("@/components/browse/use-browse-pages", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@/components/browse/use-browse-pages")
  >()),
  useBrowsePages: (args: unknown) => {
    browse.lastArgs = args;
    return browse.current;
  },
}));
vi.mock("@tanstack/react-query", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-query")>()),
  useQuery: (read: string) => ({
    data: read === "member" ? { _id: "me" } : [],
  }),
}));
vi.mock("@convex-dev/react-query", () => ({
  convexQuery: (read: string) => read,
}));
vi.mock("@/gateway", () => ({
  gateway: {
    identity: { byClerkId: "member" },
    catalog: { puzzleCategories: "categories", puzzleById: "puzzle" },
  },
}));
vi.mock("@/compat/clerk", () => ({
  useUser: () => ({ user: { id: "clerk_me" } }),
}));
vi.mock("@/hooks/use-favorites", () => ({
  useFavorites: () => ({ isFavorite: () => false, toggleFavorite: () => {} }),
}));
vi.mock("@/lib/member-display-name", () => ({
  useProjectedMemberName: () => () => "A member",
}));
vi.mock("@/components/exchange/request-trade-dialog", () => ({
  RequestTradeDialog: () => null,
}));
vi.mock("@/components/browse/puzzle-filter-chip", () => ({
  PuzzleFilterChip: () => null,
}));
vi.mock("@/components/browse/query-builder", () => ({
  QueryBuilder: ({ value }: { value: { text: string } }) => (
    <p>text condition: {JSON.stringify(value.text)}</p>
  ),
}));
vi.mock("@/components/ui/puzzle-card", () => ({
  PuzzleViewProvider: ({ children }: { children: React.ReactNode }) => children,
  PuzzleCard: () => <div>a copy</div>,
}));

vi.mock("@/components/puzzles/puzzle-card-skeleton", () => ({
  PuzzleCardSkeleton: () => <div>placeholder</div>,
}));

const copy = en.browse;
const ROW = {
  _id: "c1",
  puzzleId: "p1",
  owner: { anonymous: true },
  availability: { forTrade: true, forLend: false, forSale: false },
};
const BASE = {
  rows: [],
  hasMore: false,
  loadingMore: false,
  loading: false,
  stale: false,
  failed: false,
  loadMoreFailed: false,
  loadMore: () => {},
};

function makeRouter(href: string) {
  const rootRoute = createRootRoute({
    component: () => (
      <IntlProvider locale="en" messages={en} timeZone="Europe/Amsterdam">
        <Outlet />
      </IntlProvider>
    ),
    errorComponent: ({ error }) => <p>crashed: {String(error)}</p>,
  });
  const dashboard = createRoute({
    getParentRoute: () => rootRoute,
    id: "_dashboard",
    component: Outlet,
  });
  // Attach the real file route the way routeTree.gen does, so its useSearch/useNavigate resolve.
  const page = BrowseRoute.update({
    id: "/browse",
    path: "/browse",
    getParentRoute: () => dashboard,
  } as never);
  return createRouter({
    routeTree: rootRoute.addChildren([dashboard.addChildren([page])]),
    history: createMemoryHistory({ initialEntries: [href] }),
  });
}

describe("Browse page", () => {
  let container: HTMLDivElement;
  let root: Root;

  const open = async (href: string) => {
    await act(async () => {
      root.render(<RouterProvider router={makeRouter(href)} />);
    });
    expect(document.body.textContent).not.toContain("crashed");
  };
  const text = () => document.body.textContent ?? "";
  const button = (name: string) =>
    Array.from(document.querySelectorAll("button")).find(
      (el) => el.textContent === name,
    );

  beforeEach(() => {
    browse.current = BASE;
    browse.lastArgs = undefined;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("reads a hand-written numeric ?q as the text it was typed as", async () => {
    await open("/browse?q=1000");
    expect(text()).toContain('text condition: "1000"');
    expect(browse.lastArgs).toMatchObject({ searchTerm: "1000" });
    expect(text()).toContain(copy.empty.filteredTitle);
  });

  it("ignores a value Browse can't filter by", async () => {
    await open("/browse?condition=bogus&difficulty=bogus&avail=foo&view=foo");
    expect(browse.lastArgs).toEqual({ includeOwnPuzzles: false });
    expect(text()).toContain(copy.empty.noOffersTitle);
  });

  it("doesn't mistake a stray param for a filter when nobody offers the puzzle", async () => {
    await open("/browse?puzzle=abc&utm_source=newsletter");
    expect(text()).toContain(copy.empty.puzzleNotOfferedTitle);
    expect(text()).not.toContain(copy.empty.filteredTitle);
  });

  it("says the first page failed", async () => {
    browse.current = { ...BASE, failed: true };
    await open("/browse");
    expect(text()).toContain(copy.loadFailed);
    expect(text()).not.toContain(copy.empty.noOffersTitle);
  });

  it("shows placeholders, not an empty state, on a first visit", async () => {
    browse.current = { ...BASE, loading: true };
    await open("/browse");
    expect(text()).toContain("placeholder");
    expect(text()).not.toContain(copy.empty.noOffersTitle);
    expect(text()).not.toContain(copy.loadFailed);
  });

  it("offers Load more and shows how far it got", async () => {
    const loadMore = vi.fn();
    browse.current = {
      ...BASE,
      rows: [ROW],
      hasMore: true,
      loadMore,
    };
    await open("/browse");
    expect(text()).toContain("1+ copies found");
    await act(async () => button(copy.loadMore)?.click());
    expect(loadMore).toHaveBeenCalledTimes(1);
  });

  it("gives the count without a + once the end of the list is on screen", async () => {
    browse.current = { ...BASE, rows: [ROW] };
    await open("/browse");
    expect(text()).toContain("1 copy found");
    expect(button(copy.loadMore)).toBeFalsy();
  });

  it("doesn't call it empty while the server hasn't finished looking", async () => {
    const loadMore = vi.fn();
    browse.current = { ...BASE, hasMore: true, loadMore };
    await open("/browse?q=rare");
    expect(text()).toContain(copy.noMatchesYet);
    expect(text()).not.toContain(copy.empty.filteredTitle);
    expect(text()).not.toContain("0+");
    await act(async () => button(copy.keepLooking)?.click());
    expect(loadMore).toHaveBeenCalledTimes(1);
  });

  it("says Load more failed and lets the member try again", async () => {
    const loadMore = vi.fn();
    browse.current = {
      ...BASE,
      rows: [ROW],
      hasMore: true,
      loadMoreFailed: true,
      loadMore,
    };
    await open("/browse");
    expect(document.querySelector('[role="alert"]')?.textContent).toBe(
      copy.loadMoreFailed,
    );
    expect(text()).toContain("a copy");
    await act(async () => button(copy.loadMoreRetry)?.click());
    expect(loadMore).toHaveBeenCalledTimes(1);
  });

  it("doesn't let a click on a loading button ask for another page", async () => {
    const loadMore = vi.fn();
    browse.current = {
      ...BASE,
      rows: [ROW],
      loadingMore: true,
      loadMore,
    };
    await open("/browse");
    const loading = button(en.common.loading);
    expect(loading?.getAttribute("aria-disabled")).toBe("true");
    await act(async () => loading?.click());
    expect(loadMore).not.toHaveBeenCalled();
  });
});
