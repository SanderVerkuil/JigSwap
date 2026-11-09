// @vitest-environment happy-dom
import { gateway, type Id } from "@/gateway";
import { convexQuery, ConvexQueryClient } from "@convex-dev/react-query";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { ConvexReactClient } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import type { ComponentType, ReactNode } from "react";
import { IntlProvider } from "use-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import en from "../../../../locales/en.json";
import nl from "../../../../locales/nl.json";
import { Route } from "./$id";

const PUZZLE_ID = "puzzle1";
const mocks = vi.hoisted(() => ({
  // The manual "next page" read, through the route's Convex client.
  nextReviews: vi.fn<(query: unknown, args: unknown) => Promise<unknown>>(),
}));
// What the mocked router's notFound() returns, so a test can tell a 404 from any other throw.
const NOT_FOUND = { isNotFound: true } as const;

// The head reads the strings from the loaded catalog of the context's locale.
vi.mock("@/lib/i18n-catalog", () => ({
  messagesFor: (locale: string) => (locale === "nl" ? nl : en),
}));

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
    useRouteContext: () => ({ convexClient: { query: mocks.nextReviews } }),
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

type ReviewPage = FunctionReturnType<
  typeof gateway.social.listPublicPuzzleReviews
>;
const NO_REVIEWS: ReviewPage = { page: [], isDone: true, continueCursor: "" };

const renderDetail = (
  view: View,
  locale: "en" | "nl" = "en",
  firstPage: ReviewPage = NO_REVIEWS,
) => {
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
    convexQuery(gateway.social.listPublicPuzzleReviews, {
      puzzleId,
      paginationOpts: { numItems: 20, cursor: null },
    }).queryKey,
    firstPage,
  );
  const Page = (Route as unknown as { options: { component: ComponentType } })
    .options.component;
  return {
    ...render(
      <QueryClientProvider client={queryClient}>
        <IntlProvider
          locale={locale}
          messages={locale === "en" ? en : nl}
          timeZone="Europe/Amsterdam"
        >
          <Page />
        </IntlProvider>
      </QueryClientProvider>,
    ),
    queryClient,
  };
};

afterEach(() => {
  cleanup();
  mocks.nextReviews.mockReset();
});

const review = (id: string, text: string) =>
  ({
    id,
    author: null,
    rating: 4,
    text,
    updatedAt: 1,
  }) as ReviewPage["page"][number];

describe("public catalogue availability", () => {
  const available = {
    ...viewWith(unrated),
    availability: { total: 3, byType: { swap: 1, lend: 1, sale: 1 } },
  } as View;

  it.each([
    ["en", ["1 to swap", "1 to lend", "1 for sale"]],
    ["nl", ["1 te ruilen", "1 te leen", "1 te koop"]],
  ] as const)("says what each copy is available for (%s)", (locale, chips) => {
    renderDetail(available, locale);
    for (const chip of chips) expect(screen.getByText(chip)).toBeTruthy();
  });
});

describe("public catalogue owners", () => {
  const owned = (communityOwners: number) =>
    ({
      ...viewWith(unrated),
      stats: {
        communityOwners,
        totalCompletions: 0,
        avgCompletionDays: null,
      },
    }) as View;

  it.each([
    ["en", 1, "Community owner"],
    ["en", 2, "Community owners"],
    ["nl", 1, "Eigenaar in de community"],
    ["nl", 2, "Eigenaren in de community"],
  ] as const)(
    "labels the stat for the count (%s, %d)",
    (locale, count, label) => {
      renderDetail(owned(count), locale);
      expect(screen.getByText(label)).toBeTruthy();
    },
  );

  it("says it once when nothing is available: the stat, no sentence repeating it", () => {
    renderDetail(owned(1));
    expect(screen.getByText("Community owner")).toBeTruthy();
    expect(screen.queryByText(/in their collection/)).toBeNull();
  });
});

describe("public catalogue reviews", () => {
  it("shows the server-rendered first page with no way to more when it is all there", () => {
    renderDetail(viewWith(unrated), "en", {
      page: [review("r1", "Lovely box")],
      isDone: true,
      continueCursor: "",
    });
    expect(screen.getByText("Lovely box")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /more reviews/ })).toBeNull();
  });

  it("appends the next pages, each review once, and stops at the last", async () => {
    mocks.nextReviews.mockResolvedValue({
      page: [review("r1", "Lovely box"), review("r2", "Tough edges")],
      isDone: true,
      continueCursor: "",
    });
    renderDetail(viewWith(unrated), "en", {
      page: [review("r1", "Lovely box")],
      isDone: false,
      continueCursor: "cursor-1",
    });
    expect(screen.getByText("1+")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Show more reviews" }));
    await screen.findByText("Tough edges");
    expect(mocks.nextReviews.mock.calls[0][1]).toMatchObject({
      paginationOpts: { numItems: 20, cursor: "cursor-1" },
    });
    expect(screen.getAllByText("Lovely box")).toHaveLength(1);
    expect(screen.queryByRole("button", { name: /more reviews/ })).toBeNull();
    expect(screen.getByText("2")).toBeTruthy();
  });

  // PERF-B13: the first page is live and later pages are fixed. Left to hold its numItems, the first
  // page would drop its last row when a new review arrives, into the gap before the next page.
  it("pins the first page once a page follows it, so a new review loses no row", async () => {
    mocks.nextReviews.mockResolvedValue({
      page: [review("r2", "Tough edges")],
      isDone: true,
      continueCursor: "",
    });
    const { queryClient } = renderDetail(viewWith(unrated), "en", {
      page: [review("r1", "Lovely box")],
      isDone: false,
      continueCursor: "cursor-1",
    });
    fireEvent.click(screen.getByRole("button", { name: "Show more reviews" }));
    await screen.findByText("Tough edges");
    // While the pinned read loads, the rows on screen stay.
    expect(screen.getByText("Lovely box")).toBeTruthy();

    const pinned = convexQuery(gateway.social.listPublicPuzzleReviews, {
      puzzleId: PUZZLE_ID as Id<"puzzles">,
      paginationOpts: { numItems: 20, cursor: null, endCursor: "cursor-1" },
    }).queryKey;
    await waitFor(() =>
      expect(queryClient.getQueryState(pinned)?.fetchStatus).toBe("fetching"),
    );
    act(() => {
      queryClient.setQueryData(pinned, {
        page: [review("r3", "Brand new"), review("r1", "Lovely box")],
        isDone: false,
        continueCursor: "cursor-1",
      });
    });
    await screen.findByText("Brand new");
    expect(screen.getByText("Lovely box")).toBeTruthy();
    expect(screen.getByText("Tough edges")).toBeTruthy();
  });

  it("keeps the first page unpinned until a page follows it", () => {
    const { queryClient } = renderDetail(viewWith(unrated), "en", {
      page: [review("r1", "Lovely box")],
      isDone: false,
      continueCursor: "cursor-1",
    });
    const reads = queryClient
      .getQueryCache()
      .getAll()
      .map((query) => JSON.stringify(query.queryKey));
    expect(reads.some((read) => read.includes("endCursor"))).toBe(false);
  });
});

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

const classesOf = (el: Element | null | undefined) =>
  el?.getAttribute("class")?.split(/\s+/) ?? [];

describe("public catalogue detail layout", () => {
  // Layout can't be measured here; the first-screen fit was checked in a browser at 390, 820 and
  // 1440px. These classes are what keep the cover from filling a tablet's or phone's first screen.
  it("keeps the cover beside the details from tablets up, and landscape on phones", () => {
    renderDetail(viewWith(unrated));
    const title = screen.getByRole("heading", { level: 1 });
    const section = title.closest("section") as HTMLElement;
    expect(section.className).toContain("md:grid-cols-[260px_minmax(0,1fr)]");

    const slot = section.firstElementChild?.firstElementChild;
    expect(classesOf(slot)).toEqual(
      expect.arrayContaining([
        "aspect-[4/3]",
        "md:aspect-auto",
        "md:h-[251px]",
        "lg:h-[291px]",
      ]),
    );
  });

  // The box stands on its plank at its own size: no mat around it, the plank right under it. The
  // zoom's box hugs the picture (its lens and pinch maths assume a centred image), so it is not
  // the fill variant. Checked in a browser with landscape, portrait, panorama and tiny covers.
  it("stands the cover on its plank at the picture's own size", () => {
    renderDetail({
      ...viewWith(unrated),
      definition: {
        ...viewWith(unrated).definition,
        image: "https://cdn.test/cover.jpg",
      },
    } as View);
    const img = screen.getByRole("img", { name: "De Kattenshow" });
    const zoom = img.parentElement;
    const slot = zoom?.parentElement;
    expect(classesOf(slot)).toEqual(
      expect.arrayContaining(["flex", "items-end", "justify-center"]),
    );
    expect(classesOf(slot)).not.toContain("bg-muted");
    expect(classesOf(zoom)).not.toContain("absolute");
    expect(classesOf(img)).not.toContain("object-contain");
    expect(classesOf(img)).toEqual(
      expect.arrayContaining(["max-w-full", "rounded-t-[2px]"]),
    );
    expect(classesOf(slot?.nextElementSibling)).toContain("bg-mk-plank");
  });

  // DESIGN.md Layout: public text on a 16px margin that becomes 40px at 760px, like the header.
  it("puts the hero and the sections on the public 40px edge", () => {
    renderDetail(viewWith(unrated));
    const band = screen
      .getByRole("heading", { level: 1 })
      .closest("section")?.parentElement;
    const sections = band?.nextElementSibling;
    for (const row of [band, sections]) {
      expect(classesOf(row)).toEqual(
        expect.arrayContaining(["px-4", "min-[760px]:px-10"]),
      );
      expect(classesOf(row)).not.toContain("mx-auto");
    }
  });
});

describe("public catalogue detail actions", () => {
  const available = {
    ...viewWith(ratingOf([1, 0, 0, 0, 0])),
    availability: { total: 1, byType: { swap: 1, lend: 0, sale: 0 } },
  } as View;

  // DESIGN.md: one clear marigold action per Persuade page, at the public size.
  it("has one marigold action, at the public size", () => {
    const { container } = renderDetail(available);
    const marigold = [...container.querySelectorAll("a, button")].filter((el) =>
      classesOf(el).includes("bg-jigsaw-gold"),
    );
    expect(marigold).toHaveLength(1);
    expect(marigold[0].textContent).toBe("Join JigSwap to request a swap");
    // At least 50px, on touch too; the label may take two lines on a 320px phone.
    expect(classesOf(marigold[0])).toEqual(
      expect.arrayContaining([
        "min-h-[50px]",
        "pointer-coarse:min-h-[50px]",
        "rounded-[10px]",
        "text-[18px]",
        "font-bold",
        "whitespace-normal",
      ]),
    );
    expect(classesOf(marigold[0])).not.toContain("pointer-coarse:min-h-11");
  });

  it("makes 'Join to see who' an underlined link", () => {
    renderDetail(available);
    const link = screen.getByRole("link", { name: "Join to see who" });
    expect(classesOf(link)).toEqual(
      expect.arrayContaining(["underline", "text-mk-text-strong"]),
    );
    expect(classesOf(link)).not.toContain("bg-jigsaw-gold");
  });

  // At night the light-sky surface equals the page ground, so the panel steps up to Muted.
  it("keeps the availability panel visible at night", () => {
    renderDetail(available);
    const panel = screen.getByRole("link", {
      name: "Join to see who",
    }).parentElement;
    expect(classesOf(panel)).toEqual(
      expect.arrayContaining(["bg-mk-sky-soft", "dark:bg-mk-muted"]),
    );
  });

  // The Figures Rule: Young Serif's old-style 1 reads as an I.
  it("sets the availability count and rating average as figures", () => {
    renderDetail(available);
    const figures = [...document.querySelectorAll(".text-4xl")];
    expect(figures.map((el) => el.textContent)).toEqual(["1", "5"]);
    for (const el of figures) {
      expect(classesOf(el)).toContain("figures");
      expect(classesOf(el)).not.toContain("font-heading");
    }
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
