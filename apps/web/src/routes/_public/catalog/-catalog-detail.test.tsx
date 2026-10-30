// @vitest-environment happy-dom
import { gateway, type Id } from "@/gateway";
import { convexQuery, ConvexQueryClient } from "@convex-dev/react-query";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { ConvexReactClient } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import type { ComponentType, ReactNode } from "react";
import { IntlProvider } from "use-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import en from "../../../../locales/en.json";
import nl from "../../../../locales/nl.json";
import { Route } from "./$id";

const PUZZLE_ID = "puzzle1";

vi.mock("@/compat/link", () => ({
  Link: ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children?: ReactNode;
  }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

// The route module only needs its options back and the puzzle id param.
vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: { component: ComponentType }) => ({
    options,
    useParams: () => ({ id: PUZZLE_ID }),
  }),
  redirect: vi.fn(),
}));

type View = NonNullable<
  FunctionReturnType<typeof gateway.catalog.publicDefinitionView>
>;

const viewWith = (rating: View["rating"]): View =>
  ({
    definition: {
      title: "De Kattenshow",
      brand: "Jumbo",
      pieceCount: 1000,
      difficulty: "medium",
      tags: [],
    },
    rating,
    stats: { communityOwners: 0, totalCompletions: 0, avgCompletionDays: null },
    availability: { total: 0, byType: { swap: 0, lend: 0, sale: 0 } },
  }) as unknown as View;

type Breakdown = View["rating"]["breakdown"];
// Votes per star, five stars first (the order the page reads percentages in).
const ratingOf = (breakdown: Breakdown): View["rating"] => {
  const count = breakdown.reduce((sum, n) => sum + n, 0);
  const stars = breakdown.reduce((sum, n, i) => sum + n * (5 - i), 0);
  const pct = (n: number) => (count ? Math.round((n / count) * 100) : 0);
  const [a, b, c, d, e] = breakdown;
  return {
    rating: count ? stars / count : 0,
    count,
    breakdown,
    percentages: [pct(a), pct(b), pct(c), pct(d), pct(e)],
  };
};

const unrated = ratingOf([0, 0, 0, 0, 0]);

const renderDetail = (view: View, locale: "en" | "nl" = "en") => {
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
  const puzzleId = PUZZLE_ID as Id<"puzzles">;
  queryClient.setQueryData(
    convexQuery(gateway.catalog.publicDefinitionView, { puzzleId }).queryKey,
    view,
  );
  queryClient.setQueryData(
    convexQuery(gateway.social.listPublicPuzzleReviews, { puzzleId }).queryKey,
    [],
  );
  const Page = (Route as unknown as { options: { component: ComponentType } })
    .options.component;
  return render(
    <QueryClientProvider client={queryClient}>
      <IntlProvider
        locale={locale}
        messages={locale === "en" ? en : nl}
        timeZone="Europe/Amsterdam"
      >
        <Page />
      </IntlProvider>
    </QueryClientProvider>,
  );
};

afterEach(cleanup);

describe("public catalogue detail copy", () => {
  it("formats the piece count and difficulty in the visitor's language", () => {
    const { container } = renderDetail(viewWith(unrated), "nl");
    const text = container.textContent ?? "";
    expect(text).toContain("1.000 stukjes");
    expect(text).not.toMatch(/\bpieces\b/);
    expect(screen.getByText("Gemiddeld")).toBeTruthy();
    expect(screen.queryByText("medium")).toBeNull();
  });

  it("uses the English plural and label in English", () => {
    const { container } = renderDetail(viewWith(unrated));
    expect(container.textContent).toContain("1,000 pieces");
    expect(screen.getByText("Medium")).toBeTruthy();
  });

  it("says nobody has rated it yet instead of a 0 score and empty bars", () => {
    const { container } = renderDetail(viewWith(unrated));
    expect(screen.getByText("No ratings yet.")).toBeTruthy();
    expect(container.textContent).not.toContain("0%");
    expect(container.textContent).not.toContain("0 ratings");
  });

  it("pluralises the ratings count", () => {
    renderDetail(viewWith(ratingOf([0, 1, 0, 0, 0])));
    expect(screen.getByText("1 rating")).toBeTruthy();
    cleanup();
    renderDetail(viewWith(ratingOf([1, 1, 0, 0, 0])), "nl");
    expect(screen.getByText("2 beoordelingen")).toBeTruthy();
  });
});
