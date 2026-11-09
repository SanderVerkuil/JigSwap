// @vitest-environment happy-dom
import { gateway } from "@/gateway";
import {
  publicCatalogFilterArgs,
  type PublicCatalogSearch,
} from "@/lib/public-catalog-search";
import { convexQuery, ConvexQueryClient } from "@convex-dev/react-query";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { ConvexReactClient } from "convex/react";
import type { ComponentType, ReactNode } from "react";
import { IntlProvider } from "use-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import en from "../../../../locales/en.json";
import nl from "../../../../locales/nl.json";
import { Route } from "./index";

const router = vi.hoisted(() => ({
  search: {} as PublicCatalogSearch,
  navigate: vi.fn(),
}));
const auth = vi.hoisted(() => ({ signedIn: false }));

vi.mock("convex/react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("convex/react")>()),
  Unauthenticated: ({ children }: { children: ReactNode }) =>
    auth.signedIn ? null : children,
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

// The route module only needs its options back, the URL's search params and a navigate spy.
vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: { component: ComponentType }) => ({
    options,
    fullPath: "/catalog/",
    useSearch: () => router.search,
    useRouteContext: () => ({ convexClient: {} }),
  }),
  useNavigate: () => router.navigate,
}));

const emptyPage = { page: [], isDone: true, continueCursor: "" };

const card = (title: string) => ({
  _id: title,
  title,
  brand: "Jumbo",
  pieceCount: 1000,
  image: null,
  rating: { value: 0, count: 0 },
  availableToSwap: 0,
});

// Three pages of one card each, by the cursor that asks for them.
const THREE_PAGES = {
  first: { page: [card("Harbour")], isDone: false, continueCursor: "c2" },
  c2: { page: [card("Windmill")], isDone: false, continueCursor: "c3" },
  c3: { page: [card("Tulips")], isDone: true, continueCursor: "end" },
};

const pageQueryKey = (search: PublicCatalogSearch, cursor: string | null) =>
  convexQuery(gateway.catalog.publicBrowse, {
    paginationOpts: { numItems: 20, cursor },
    ...publicCatalogFilterArgs(search),
  }).queryKey;

const queryClientFor = (
  search: PublicCatalogSearch,
  pages: Record<string, unknown> = { first: emptyPage },
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
  queryClient.setQueryData(
    convexQuery(gateway.catalog.allBrands, {}).queryKey,
    ["Jumbo"],
  );
  for (const [cursor, page] of Object.entries(pages)) {
    queryClient.setQueryData(
      pageQueryKey(search, cursor === "first" ? null : cursor),
      page,
    );
  }
  return queryClient;
};

const Page = (Route as unknown as { options: { component: ComponentType } })
  .options.component;

const pageAt = (locale: "en" | "nl") => (
  <IntlProvider
    locale={locale}
    messages={locale === "nl" ? nl : en}
    timeZone="Europe/Amsterdam"
  >
    <Page />
  </IntlProvider>
);

const renderAt = (
  search: PublicCatalogSearch,
  locale: "en" | "nl" = "en",
  pages?: Record<string, unknown>,
) => {
  router.search = search;
  const client = queryClientFor(search, pages);
  const view = render(
    <QueryClientProvider client={client}>{pageAt(locale)}</QueryClientProvider>,
  );
  return {
    ...view,
    // What a URL change does: the page re-renders with the new search params.
    changeUrl: (next: PublicCatalogSearch) => {
      router.search = next;
      const nextClient = queryClientFor(next);
      for (const query of nextClient.getQueryCache().getAll()) {
        client.setQueryData(query.queryKey, query.state.data);
      }
      view.rerender(
        <QueryClientProvider client={client}>
          {pageAt(locale)}
        </QueryClientProvider>,
      );
    },
  };
};

// The URL write the page last asked for: its search updater applied to the current search.
const lastUrlWrite = () => {
  const call = router.navigate.mock.lastCall?.[0] as {
    search: (prev: PublicCatalogSearch) => PublicCatalogSearch;
    replace: boolean;
    resetScroll: boolean;
  };
  return { ...call, search: call.search(router.search) };
};

const searchBox = () => screen.getByRole<HTMLInputElement>("searchbox");

const advanceDebounce = () => {
  act(() => {
    vi.advanceTimersByTime(300);
  });
};

beforeEach(() => {
  router.navigate.mockClear();
  auth.signedIn = false;
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

describe("public catalogue controls", () => {
  it.each([
    ["en", "Search puzzles", "Brand", "Piece count"],
    ["nl", "Puzzels zoeken", "Merk", "Aantal stukjes"],
  ] as const)(
    "names the search and both filters (%s)",
    (locale, search, brand, pieces) => {
      renderAt({}, locale);
      expect(screen.getByRole("searchbox", { name: search })).toBeTruthy();
      expect(screen.getByRole("combobox", { name: brand })).toBeTruthy();
      expect(screen.getByRole("combobox", { name: pieces })).toBeTruthy();
    },
  );

  it("has a heading between the h1 and the card titles", () => {
    renderAt({});
    expect(
      screen.getByRole("heading", { level: 1, name: "Puzzle catalogue" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("heading", { level: 2, name: "Results" }),
    ).toBeTruthy();
  });

  it("titles the cards one level below the Results heading", () => {
    renderAt({}, "en", { first: THREE_PAGES.first });
    expect(
      screen.getByRole("heading", { level: 3, name: "Harbour" }),
    ).toBeTruthy();
  });

  it("asks visitors to join, but not members", () => {
    const { unmount } = renderAt({});
    expect(
      screen.getByRole("link", { name: "Join JigSwap to request a swap" }),
    ).toBeTruthy();
    unmount();

    auth.signedIn = true;
    renderAt({});
    expect(
      screen.queryByRole("link", { name: "Join JigSwap to request a swap" }),
    ).toBeNull();
  });

  // The page's one marigold action, at the public size (DESIGN.md Buttons); its label is wider
  // than a 320px phone, so it may take two lines rather than run off the screen.
  it("asks at the public size, wrapping on a narrow phone", () => {
    renderAt({});
    const join = screen.getByRole("link", {
      name: "Join JigSwap to request a swap",
    });
    expect(join.className.split(/\s+/)).toEqual(
      expect.arrayContaining([
        "bg-jigsaw-gold",
        "min-h-[50px]",
        "pointer-coarse:min-h-[50px]",
        "rounded-[10px]",
        "text-[18px]",
        "font-bold",
        "max-w-full",
        "whitespace-normal",
      ]),
    );
    // On touch the base's 44px floor would win over min-h-[50px]; the 50px one replaces it.
    expect(join.className.split(/\s+/)).not.toContain(
      "pointer-coarse:min-h-11",
    );
  });

  it("shows the URL's filters", () => {
    renderAt({ q: "castle", brand: "Jumbo", pieces: "b1000" });
    expect(searchBox().value).toBe("castle");
    expect(screen.getByRole("combobox", { name: "Brand" }).textContent).toBe(
      "Jumbo",
    );
    expect(
      screen.getByRole("combobox", { name: "Piece count" }).textContent,
    ).toBe("1,000 – 1,499 pieces");
  });
});

describe("public catalogue search in the URL", () => {
  it("writes the term once typing pauses, replacing the history entry", () => {
    vi.useFakeTimers();
    renderAt({ brand: "Jumbo" });

    fireEvent.change(searchBox(), { target: { value: " castle " } });
    expect(router.navigate).not.toHaveBeenCalled();
    advanceDebounce();

    expect(lastUrlWrite()).toEqual({
      search: { brand: "Jumbo", q: "castle" },
      replace: true,
      resetScroll: false,
    });
  });

  it("takes over a term from elsewhere: Back and a shared link", () => {
    const { changeUrl } = renderAt({ q: "castle" });

    changeUrl({});
    expect(searchBox().value).toBe("");

    changeUrl({ q: "1000" });
    expect(searchBox().value).toBe("1000");
  });

  it("keeps what was typed since, when its own write comes back from the URL", () => {
    vi.useFakeTimers();
    const { changeUrl } = renderAt({});

    fireEvent.change(searchBox(), { target: { value: "cas" } });
    advanceDebounce();
    fireEvent.change(searchBox(), { target: { value: "castle" } });
    changeUrl({ q: "cas" });

    expect(searchBox().value).toBe("castle");
  });

  it("clears the term from the URL when the box is emptied", () => {
    vi.useFakeTimers();
    renderAt({ q: "castle" });

    fireEvent.change(searchBox(), { target: { value: "  " } });
    advanceDebounce();

    expect(lastUrlWrite().search.q).toBeUndefined();
  });
});

describe("public catalogue Load more in the URL", () => {
  const loader = (
    Route as unknown as {
      options: {
        loader: (args: {
          context: { queryClient: QueryClient };
          deps: PublicCatalogSearch;
          cause: string;
        }) => Promise<void>;
      };
    }
  ).options.loader;

  it("writes how many pages show, keeping the filters and the scroll position", async () => {
    renderAt({ brand: "Jumbo" }, "en", {
      first: THREE_PAGES.first,
      c2: THREE_PAGES.c2,
    });

    fireEvent.click(screen.getByRole("button", { name: "Load more" }));
    await vi.waitFor(() => expect(router.navigate).toHaveBeenCalled());

    expect(lastUrlWrite()).toEqual({
      search: { brand: "Jumbo", pages: 2 },
      replace: true,
      resetScroll: false,
    });
  });

  it("restores the pages a URL names from what the loader fetched", () => {
    renderAt({ pages: 3 }, "en", THREE_PAGES);
    for (const title of ["Harbour", "Windmill", "Tulips"]) {
      expect(screen.getByRole("heading", { name: title })).toBeTruthy();
    }
    expect(screen.queryByRole("button", { name: "Load more" })).toBeNull();
  });

  it("stops at the pages it has when the URL names more than exist", () => {
    renderAt({ pages: 9 }, "en", THREE_PAGES);
    expect(screen.getByRole("heading", { name: "Tulips" })).toBeTruthy();
  });

  it("shows only the first page without a page count, as after a Catalogue link", () => {
    const { changeUrl } = renderAt({ pages: 2 }, "en", THREE_PAGES);
    expect(screen.getByRole("heading", { name: "Windmill" })).toBeTruthy();

    changeUrl({});

    expect(screen.queryByRole("heading", { name: "Windmill" })).toBeNull();
  });

  it("starts over at one page when a filter changes", () => {
    vi.useFakeTimers();
    renderAt({ q: "castle", pages: 3 });

    fireEvent.change(searchBox(), { target: { value: "bridge" } });
    advanceDebounce();

    expect(lastUrlWrite().search).toEqual({ q: "bridge" });
  });

  it("loads every page the URL names before the page renders", async () => {
    const asked: unknown[] = [];
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          queryFn: ({ queryKey }) => {
            const { paginationOpts } = queryKey[2] as {
              paginationOpts: { cursor: string | null };
            };
            asked.push(paginationOpts.cursor);
            const pages: Record<string, unknown> = THREE_PAGES;
            return pages[paginationOpts.cursor ?? "first"];
          },
        },
      },
    });

    await loader({
      context: { queryClient },
      deps: { pages: 9 },
      cause: "enter",
    });

    // Stops at the last page, however many the URL names.
    expect(asked).toEqual([null, "c2", "c3"]);
  });
});

describe("public catalogue empty states", () => {
  it("says the catalogue is new only when nothing filters it", () => {
    renderAt({});
    expect(
      screen.getByText("The catalogue is just getting started"),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Clear/ })).toBeNull();
  });

  it("offers more instead of 'no matches' when the server stopped a bounded read early", () => {
    router.search = { brand: "Jumbo", pieces: "b1500" };
    const client = queryClientFor(router.search);
    client.setQueryData(
      convexQuery(gateway.catalog.publicBrowse, {
        paginationOpts: { numItems: 20, cursor: null },
        ...publicCatalogFilterArgs(router.search),
      }).queryKey,
      { page: [], isDone: false, continueCursor: "cut-here" },
    );
    render(
      <QueryClientProvider client={client}>{pageAt("en")}</QueryClientProvider>,
    );
    expect(screen.queryByText("No puzzles match these filters")).toBeNull();
    expect(
      screen.getByRole("button", { name: en.publicCatalog.loadMore }),
    ).toBeTruthy();
  });

  it("offers to clear a search with no matches", () => {
    renderAt({ q: "zzz" });
    expect(screen.getByText('No puzzles match "zzz"')).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Clear search" }));

    expect(lastUrlWrite().search.q).toBeUndefined();
    expect(searchBox().value).toBe("");
  });

  it.each([
    [
      "en",
      { pieces: "lt500" },
      "No puzzles match these filters",
      "Clear filters",
    ],
    [
      "en",
      { brand: "NoSuchBrand" },
      "No puzzles match these filters",
      "Clear filters",
    ],
    [
      "nl",
      { pieces: "lt500" },
      "Geen puzzels gevonden met deze filters",
      "Filters wissen",
    ],
  ] as const)(
    "offers to clear a filter-only URL with no matches (%s, %j)",
    (locale, search, title, clear) => {
      renderAt(search, locale);
      expect(screen.getByText(title)).toBeTruthy();
      expect(
        screen.queryByText("The catalogue is just getting started"),
      ).toBeNull();

      fireEvent.click(screen.getByRole("button", { name: clear }));

      expect(lastUrlWrite().search).toEqual({
        q: undefined,
        brand: undefined,
        pieces: undefined,
      });
    },
  );

  it("clears the filters too when a search and a filter find nothing together", () => {
    renderAt({ q: "zzz", pieces: "lt500" });
    expect(screen.getByText('No puzzles match "zzz"')).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));

    expect(lastUrlWrite().search).toEqual({
      q: undefined,
      brand: undefined,
      pieces: undefined,
    });
    expect(searchBox().value).toBe("");
  });
});
