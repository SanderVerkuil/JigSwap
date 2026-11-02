// @vitest-environment node
// The "-" prefix keeps the TanStack route generator from treating this file as a route.
import { prefetchMyPuzzles } from "@/components/library/prefetch-my-puzzles";
import { gateway } from "@/gateway";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { getFunctionName } from "convex/server";
import type { ComponentType, ReactNode } from "react";
import { renderToString } from "react-dom/server";
import { IntlProvider } from "use-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import en from "../../../../locales/en.json";
import { Route } from "./index";

// PERF-D1: what the server renders for My Puzzles. A plain list is in the first paint (this runs on
// Node, so nothing may touch window); a search, sort or status pill is left to the browser, because
// it needs the whole library, which doesn't belong in a page's HTML.

const location = vi.hoisted(() => ({ search: {} as Record<string, unknown> }));

vi.mock("@/compat/clerk", () => ({
  useAuth: () => ({ isSignedIn: true }),
}));
vi.mock("@/compat/link", () => ({
  Link: ({ href, children }: { href: string; children?: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock("@/compat/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock("@convex-dev/react-query", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@convex-dev/react-query")>()),
  useConvexMutation: () => vi.fn(),
}));
vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: object) => ({
    options,
    fullPath: "/my-puzzles/",
    useSearch: () => location.search,
  }),
  useNavigate: () => vi.fn(),
}));

const name = getFunctionName;
const WINDOW = name(gateway.library.myLibraryWindow);
const INDEX = name(gateway.library.myLibraryIndex);
const COPY = {
  _id: "copy1",
  aggregateId: "agg1",
  puzzleId: "p1",
  ownerId: "me",
  condition: "good",
  availability: { forTrade: true, forLend: false, forSale: false },
  visibility: "visible",
  createdAt: 1,
  updatedAt: 1,
  puzzle: {
    _id: "p1",
    title: "Lighthouse at dusk",
    pieceCount: 1000,
    createdAt: 1,
    updatedAt: 1,
  },
};
const ANSWERS: Record<string, unknown> = {
  [name(gateway.identity.currentUser)]: { _id: "me" },
  [name(gateway.household.mine)]: null,
  [name(gateway.lending.lentOut)]: [],
  [name(gateway.solving.mySolveStates)]: [],
  [name(gateway.catalog.listMyBoxArtInCheck)]: [],
  [WINDOW]: { rows: [COPY], hasMore: false, matched: 1, total: 1 },
};

const clientAnswering = () => {
  const asked: unknown[][] = [];
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        queryFn: ({ queryKey }) => {
          asked.push([queryKey[1], queryKey[2]]);
          const answer = ANSWERS[queryKey[1] as string];
          if (answer === undefined) throw new Error(`${queryKey[1]} failed`);
          return answer;
        },
      },
    },
  });
  return { queryClient, asked };
};

const renderPage = (queryClient: QueryClient) => {
  const Page = (Route as unknown as { options: { component: ComponentType } })
    .options.component;
  return renderToString(
    <QueryClientProvider client={queryClient}>
      <IntlProvider
        locale="en"
        messages={en}
        timeZone="Europe/Amsterdam"
        now={new Date(0)}
      >
        <Page />
      </IntlProvider>
    </QueryClientProvider>,
  );
};

beforeEach(() => {
  location.search = {};
});

describe("My Puzzles on the server", () => {
  it("paints the list itself, with nothing left for the browser to read first", async () => {
    const { queryClient } = clientAnswering();
    await prefetchMyPuzzles(queryClient, {});

    const html = renderPage(queryClient);
    expect(html).toContain("Lighthouse at dusk");
    expect(html).toContain("1 of 1 puzzle");
    expect(html).not.toContain('data-slot="skeleton"');
    expect(
      queryClient
        .getQueryCache()
        .getAll()
        .filter((query) => query.queryKey[2] !== "skip")
        .filter((query) => query.state.status !== "success")
        .map((query) => query.queryKey[1]),
    ).toEqual([]);
  });

  it("names the chosen sort, which the select can't work out until it's hydrated", async () => {
    const { queryClient } = clientAnswering();
    await prefetchMyPuzzles(queryClient, {});
    expect(renderPage(queryClient)).toContain("Recently added");
  });

  it("holds the phone's actions row, which the shell only shows after hydration", async () => {
    const { queryClient } = clientAnswering();
    await prefetchMyPuzzles(queryClient, {});
    expect(renderPage(queryClient)).toContain(
      'aria-hidden="true" class="-mb-0.5 h-8 md:hidden pointer-coarse:h-11"',
    );
  });

  it("leaves the one-time hint out: only the browser knows if it was dismissed", async () => {
    const { queryClient } = clientAnswering();
    await prefetchMyPuzzles(queryClient, {});
    expect(renderPage(queryClient)).not.toContain(en.puzzles.coachmark.body);
  });

  it("reads the whose filter's window, with the page's own arguments", async () => {
    const { queryClient, asked } = clientAnswering();
    await prefetchMyPuzzles(queryClient, { owner: "mine" });
    expect(asked).toContainEqual([WINDOW, { owner: "mine", limit: 48 }]);
  });

  it.each([
    ["a search", { q: "light" }],
    ["a sort", { sort: "title" as const }],
    ["a status pill", { status: "forTrade" as const }],
  ])("never puts the whole library in the HTML for %s", async (_, search) => {
    location.search = search;
    const { queryClient, asked } = clientAnswering();
    await prefetchMyPuzzles(queryClient, search);
    const read = asked.map(([fn]) => fn);
    expect(read).not.toContain(WINDOW);
    expect(read).not.toContain(INDEX);
    expect(() => renderPage(queryClient)).not.toThrow();
  });

  it("still renders when a read fails", async () => {
    const { queryClient } = clientAnswering();
    const rows = ANSWERS[WINDOW];
    delete ANSWERS[WINDOW];
    try {
      await expect(prefetchMyPuzzles(queryClient, {})).resolves.toBeUndefined();
      expect(() => renderPage(queryClient)).not.toThrow();
    } finally {
      ANSWERS[WINDOW] = rows;
    }
  });
});
