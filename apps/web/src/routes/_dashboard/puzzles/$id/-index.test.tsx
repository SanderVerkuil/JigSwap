// @vitest-environment happy-dom
// The "-" prefix keeps the TanStack route generator from treating this file as a route.
import { gateway } from "@/gateway";
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { cleanup, render, screen } from "@testing-library/react";
import { getFunctionName } from "convex/server";
import { IntlProvider } from "use-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import en from "../../../../../locales/en.json";
import { Route as PuzzleRoute } from "./index";

const MY_REVIEWS = getFunctionName(gateway.solving.getMyReviews);
const VIEW = getFunctionName(gateway.library.getPuzzleDefinitionView);

const mocks = vi.hoisted(() => ({
  queries: {} as Record<string, unknown>,
}));

// Queries resolve from `mocks.queries` by function name; anything else stays unresolved.
vi.mock("@tanstack/react-query", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-query")>()),
  useQuery: (options: { queryKey: unknown[] }) => ({
    data: mocks.queries[options.queryKey[1] as string],
  }),
  useMutation: () => ({ isPending: false, mutateAsync: vi.fn() }),
}));
vi.mock("@convex-dev/react-query", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@convex-dev/react-query")>()),
  useConvexMutation: () => vi.fn(),
}));
vi.mock("@/components/dashboard-layout/page-header-slot", () => ({
  usePageHeader: () => {},
}));
vi.mock("@/hooks/use-favorites", () => ({
  useFavorites: () => ({ isFavorite: () => false, toggleFavorite: vi.fn() }),
}));
vi.mock("@/hooks/use-box-art-check", () => ({
  useBoxArtInCheck: () => new Set<string>(),
}));

const view = {
  definition: {
    title: "Lighthouse",
    pieceCount: 1000,
    tags: [],
  },
  rating: { rating: 0, count: 0, percentages: [0, 0, 0, 0, 0] },
  stats: {
    communityOwners: 0,
    totalCompletions: 0,
    availableToSwap: 0,
  },
  ownership: { viewerOwns: false },
  availableCopies: [],
  totalAvailable: 0,
};

const renderPage = async () => {
  const rootRoute = createRootRoute();
  const puzzle = PuzzleRoute.update({
    id: "/puzzles/$id/",
    path: "/puzzles/$id/",
    getParentRoute: () => rootRoute,
  } as never);
  const router = createRouter({
    routeTree: rootRoute.addChildren([puzzle]),
    history: createMemoryHistory({ initialEntries: ["/puzzles/p1"] }),
  });
  await router.load();
  render(
    <IntlProvider locale="en" messages={en} timeZone="Europe/Amsterdam">
      <RouterProvider router={router} />
    </IntlProvider>,
  );
  await screen.findByRole("heading", { name: "Lighthouse" });
};

const writeReview = () =>
  screen.queryByRole("button", { name: "Write a Review" });

beforeEach(() => {
  mocks.queries = { [VIEW]: view };
});
afterEach(cleanup);

describe("Puzzle page review action", () => {
  it("offers Write a Review when the viewer may review the definition", async () => {
    mocks.queries[MY_REVIEWS] = { puzzle: null, puzzleReviewAllowed: true };
    await renderPage();
    expect(writeReview()).not.toBeNull();
    expect(screen.queryByText(en.puzzleDefinition.reviewNotOpen)).toBeNull();
  });

  it("hides Write a Review with the composer on a definition the viewer may not review", async () => {
    mocks.queries[MY_REVIEWS] = { puzzle: null, puzzleReviewAllowed: false };
    await renderPage();
    expect(writeReview()).toBeNull();
    expect(screen.getByText(en.puzzleDefinition.reviewNotOpen)).not.toBeNull();
  });

  it("keeps Write a Review while loading, or from a backend without the flag", async () => {
    await renderPage();
    expect(writeReview()).not.toBeNull();
    cleanup();

    mocks.queries[MY_REVIEWS] = { puzzle: null };
    await renderPage();
    expect(writeReview()).not.toBeNull();
  });
});
