// @vitest-environment node
// The "-" prefix keeps the TanStack route generator from treating this file as a route.
import { prefetchDashboardHome } from "@/components/dashboard-home/prefetch-dashboard-home";
import { gateway } from "@/gateway";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { getFunctionName } from "convex/server";
import type { ComponentType, ReactNode } from "react";
import { renderToString } from "react-dom/server";
import { IntlProvider } from "use-intl";
import { describe, expect, it, vi } from "vitest";
import en from "../../../locales/en.json";
import { Route } from "./dashboard";

// PERF-D1: what the server renders for /dashboard. With the page's reads prefetched, the first paint
// is the page itself: no window (this runs on Node) and no skeleton left waiting for the browser.

vi.mock("@/compat/clerk", () => ({
  useAuth: () => ({ isSignedIn: true }),
  useUser: () => ({ user: undefined, isLoaded: false }),
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
  createFileRoute: () => (options: object) => ({ options }),
  useNavigate: () => vi.fn(),
  useRouter: () => ({ navigate: vi.fn() }),
  useRouterState: () => "/dashboard",
  Link: ({ children }: { children?: ReactNode }) => <a>{children}</a>,
}));

const name = getFunctionName;
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
  [name(gateway.identity.currentUser)]: { _id: "me", name: "Henk" },
  [name(gateway.exchange.myLive)]: [],
  [name(gateway.exchange.myHistory)]: {
    page: [],
    isDone: true,
    continueCursor: "",
  },
  [name(gateway.solving.myGoals)]: [],
  [name(gateway.solving.myInProgress)]: [],
  [name(gateway.library.myShelf)]: { total: 1, forTrade: 1, recent: [COPY] },
  [name(gateway.identity.userStats)]: {
    totalPuzzles: 1,
    totalCompletions: 0,
    averageRating: 0,
  },
  [name(gateway.identity.byId)]: { _id: "anna", name: "Anna" },
  [name(gateway.social.activityFeed)]: [
    {
      kind: "added",
      memberId: "anna",
      createdAt: 1,
      puzzle: { title: "Windmill", _id: "p2" },
    },
    { kind: "added", memberId: "me", createdAt: 1, puzzle: { title: "Mine" } },
    {
      kind: "added",
      memberId: "anna",
      createdAt: 1,
      puzzle: { title: "Ship" },
    },
  ],
  [name(gateway.onboarding.quickStart)]: null,
  [name(gateway.social.connectionOffers)]: [],
  [name(gateway.catalog.listMyBoxArtInCheck)]: [],
};

const clientAnswering = () => {
  const asked: string[] = [];
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        queryFn: ({ queryKey }) => {
          asked.push(JSON.stringify(queryKey.slice(1, 3)));
          const answer = ANSWERS[queryKey[1] as string];
          if (answer === undefined) throw new Error(`${queryKey[1]} failed`);
          return answer;
        },
      },
    },
  });
  return { queryClient, asked };
};

const renderPage = (queryClient: QueryClient, now = new Date(0)) => {
  const Page = (Route as unknown as { options: { component: ComponentType } })
    .options.component;
  return renderToString(
    <QueryClientProvider client={queryClient}>
      <IntlProvider
        locale="en"
        messages={en}
        timeZone="Europe/Amsterdam"
        now={now}
      >
        <Page />
      </IntlProvider>
    </QueryClientProvider>,
  );
};

describe("the dashboard home on the server", () => {
  it("paints the page itself once its reads are in, with no skeleton waiting", async () => {
    const { queryClient } = clientAnswering();
    await prefetchDashboardHome(queryClient);

    const html = renderPage(queryClient);
    expect(html).toContain("Your Shelf");
    expect(html).toContain("Lighthouse at dusk");
    expect(html).toContain("Solving now");
    expect(html).not.toContain('data-slot="skeleton"');
  });

  it("reads exactly what the sections ask for, including each other member once", async () => {
    const { queryClient, asked } = clientAnswering();
    await prefetchDashboardHome(queryClient);
    // Everything the render asked for was in the cache: nothing is left for the browser to fetch.
    renderPage(queryClient);
    const left = queryClient
      .getQueryCache()
      .getAll()
      .filter((query) => query.queryKey[2] !== "skip")
      .filter((query) => query.state.status !== "success")
      .map((query) => query.queryKey[1]);
    expect(left).toEqual([]);

    expect(
      asked.filter((key) => key.includes(name(gateway.identity.byId))),
    ).toEqual([
      JSON.stringify([name(gateway.identity.byId), { userId: "anna" }]),
    ]);
  });

  it("still renders, with skeletons, when a read fails", async () => {
    const { queryClient } = clientAnswering();
    const shelf = ANSWERS[name(gateway.library.myShelf)];
    delete ANSWERS[name(gateway.library.myShelf)];
    try {
      await expect(prefetchDashboardHome(queryClient)).resolves.toBeUndefined();
      expect(renderPage(queryClient)).toContain('data-slot="skeleton"');
    } finally {
      ANSWERS[name(gateway.library.myShelf)] = shelf;
    }
  });

  // The server runs in UTC and the browser where the member is, so a "today" taken from the runtime
  // would differ between the server's HTML and the first client render for hours around midnight.
  it("paints the same page whatever zone the server runs in", async () => {
    // 00:30 on 3 November in Amsterdam, the 2nd in UTC and New York.
    const instant = new Date("2026-11-02T23:30:00Z");
    const goals = ANSWERS[name(gateway.solving.myGoals)];
    const solves = ANSWERS[name(gateway.solving.myInProgress)];
    ANSWERS[name(gateway.solving.myGoals)] = [
      {
        _id: "g1",
        title: "Last day was the 2nd",
        targetCompletions: 10,
        currentCompletions: 1,
        isActive: true,
        isAchieved: false,
        targetDate: Date.UTC(2026, 10, 2),
      },
    ];
    ANSWERS[name(gateway.solving.myInProgress)] = [
      {
        completionId: "c1",
        title: "Started on the 3rd",
        startDate: Date.UTC(2026, 10, 3),
      },
    ];
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(instant);
    try {
      const { queryClient } = clientAnswering();
      await prefetchDashboardHome(queryClient);
      const paintIn = (tz: string) => {
        vi.stubEnv("TZ", tz);
        return renderPage(queryClient, instant);
      };
      const html = paintIn("Europe/Amsterdam");
      expect(html).toContain("Started today");
      expect(html).not.toContain("Last day was the 2nd");
      expect(paintIn("UTC")).toBe(html);
      expect(paintIn("America/New_York")).toBe(html);
      expect(paintIn("Asia/Tokyo")).toBe(html);
    } finally {
      vi.useRealTimers();
      vi.unstubAllEnvs();
      ANSWERS[name(gateway.solving.myGoals)] = goals;
      ANSWERS[name(gateway.solving.myInProgress)] = solves;
    }
  });

  it("reads no one else's data when the session has no member", async () => {
    const { queryClient, asked } = clientAnswering();
    const me = ANSWERS[name(gateway.identity.currentUser)];
    ANSWERS[name(gateway.identity.currentUser)] = null;
    try {
      await prefetchDashboardHome(queryClient);
      expect(
        asked.some((key) => key.includes(name(gateway.identity.userStats))),
      ).toBe(false);
      expect(
        asked.some((key) => key.includes(name(gateway.identity.byId))),
      ).toBe(false);
    } finally {
      ANSWERS[name(gateway.identity.currentUser)] = me;
    }
  });
});
