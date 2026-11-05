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
// What the mocked router's notFound() returns, so a test can tell a 404 from any other throw.
const NOT_FOUND = { isNotFound: true } as const;

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
  notFound: () => NOT_FOUND,
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

describe("public catalogue detail layout", () => {
  // Layout can't be measured here; the first-screen fit was checked in a browser at 390, 820 and
  // 1440px. These classes are what keep the cover from filling a tablet's or phone's first screen.
  it("keeps the cover beside the details from tablets up, and landscape on phones", () => {
    renderDetail(viewWith(unrated));
    const title = screen.getByRole("heading", { level: 1 });
    const section = title.closest("section") as HTMLElement;
    expect(section.className).toContain("md:grid-cols-[260px_minmax(0,1fr)]");

    const cover = section.firstElementChild as HTMLElement;
    expect(cover.className).toContain("aspect-[4/3]");
    expect(cover.className).toContain("md:aspect-square");
  });
});

type HeadFn = (ctx: {
  loaderData?: { view: View | null };
  match: { context: unknown; pathname: string; status?: string };
}) => { meta?: Array<Record<string, string>> };
const head = (Route as unknown as { options: { head: HeadFn } }).options.head;
const headMatch = (locale: "en" | "nl") => ({
  context: {
    intl: {
      locale,
      messages: locale === "en" ? en : nl,
      timeZone: "Europe/Amsterdam",
      now: 0,
    },
  },
  pathname: `/catalog/${PUZZLE_ID}`,
});

describe("public catalogue detail head", () => {
  it("describes the puzzle in the visitor's language", () => {
    const { meta } = head({
      loaderData: { view: viewWith(unrated) },
      match: headMatch("nl"),
    });
    expect(meta).toContainEqual({ title: "De Kattenshow — JigSwap" });
    expect(meta).toContainEqual({
      name: "description",
      content:
        "De Kattenshow van Jumbo — legpuzzel van 1.000 stukjes. Sterren, reviews en ruilbeschikbaarheid in de JigSwap-community.",
    });
    expect(meta).toContainEqual({ property: "og:locale", content: "nl_NL" });
  });

  it("keeps the English description for English visitors", () => {
    const { meta } = head({
      loaderData: { view: viewWith(unrated) },
      match: headMatch("en"),
    });
    expect(meta).toContainEqual({
      name: "description",
      content:
        "De Kattenshow by Jumbo — 1,000-piece jigsaw puzzle. Community rating, reviews and swap availability on JigSwap.",
    });
  });
});

type LoaderFn = (ctx: {
  context: {
    queryClient: { ensureQueryData: (q: unknown) => Promise<unknown> };
  };
  params: { id: string };
}) => Promise<{ view: View }>;
const loader = (Route as unknown as { options: { loader: LoaderFn } }).options
  .loader;
// The loader reads the view first and the reviews second; `view` is what the first read yields.
const loadWith = (view: () => Promise<unknown>) =>
  loader({
    context: {
      queryClient: {
        ensureQueryData: vi
          .fn()
          .mockImplementationOnce(view)
          .mockImplementationOnce(() => Promise.resolve([])),
      },
    },
    params: { id: PUZZLE_ID },
  });

describe("public catalogue detail not found", () => {
  it("answers a nonexistent puzzle with a real 404", async () => {
    await expect(loadWith(() => Promise.resolve(null))).rejects.toBe(NOT_FOUND);
  });

  // A string that names no puzzle answers null (publicCatalog.test.ts), so a rejection is a failed
  // read: an outage must not tell crawlers a puzzle in the sitemap is gone.
  it.each([
    ["a network failure", new TypeError("fetch failed")],
    ["the platform's error page", new Error("<html>502 Bad Gateway</html>")],
    ["a failing function", new Error("[Request ID: abc] Server Error")],
  ])("rethrows %s to the error boundary, not a 404", async (_, failure) => {
    await expect(loadWith(() => Promise.reject(failure))).rejects.toBe(failure);
  });

  it("still loads a puzzle when only its reviews fail", async () => {
    const view = viewWith(unrated);
    await expect(
      loader({
        context: {
          queryClient: {
            ensureQueryData: vi
              .fn()
              .mockResolvedValueOnce(view)
              .mockRejectedValueOnce(new Error("Server Error")),
          },
        },
        params: { id: PUZZLE_ID },
      }),
    ).resolves.toEqual({ view });
  });

  it("loads an existing puzzle", async () => {
    const view = viewWith(unrated);
    await expect(loadWith(() => Promise.resolve(view))).resolves.toEqual({
      view,
    });
  });

  it("titles the 404 as a missing page", () => {
    const { meta } = head({
      match: { ...headMatch("nl"), status: "notFound" },
    });
    expect(meta).toEqual([{ title: nl.marketing.titles.notFound }]);
  });

  it("doesn't call a failed read a missing page", () => {
    const { meta } = head({ match: { ...headMatch("nl"), status: "error" } });
    expect(meta).toBeUndefined();
  });

  it("says a failed read is on our side and offers the way back", () => {
    const LoadError = (
      Route as unknown as { options: { errorComponent: ComponentType } }
    ).options.errorComponent;
    render(
      <IntlProvider locale="nl" messages={nl} timeZone="Europe/Amsterdam">
        <LoadError />
      </IntlProvider>,
    );
    expect(
      screen.getByRole("heading", {
        level: 1,
        name: "We konden deze puzzel niet laden",
      }),
    ).toBeTruthy();
    expect(screen.queryByText("404")).toBeNull();
    expect(
      screen
        .getByRole("link", { name: nl.notFound.browseCatalogue })
        .getAttribute("href"),
    ).toBe("/catalog");
  });

  it("shows a heading and a way back to the catalogue when the puzzle is gone", () => {
    renderDetail(null as unknown as View);
    expect(
      screen.getByRole("heading", { level: 1, name: "Puzzle not found" }),
    ).toBeTruthy();
    expect(
      screen
        .getByRole("link", { name: "Browse the catalogue" })
        .getAttribute("href"),
    ).toBe("/catalog");
  });
});
