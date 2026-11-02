// @vitest-environment happy-dom
// The "-" prefix keeps the TanStack route generator from treating this file as a route.
import { gateway } from "@/gateway";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { getFunctionName, type FunctionReturnType } from "convex/server";
import type { ReactNode } from "react";
import { IntlProvider } from "use-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import en from "../../../../../locales/en.json";
import nl from "../../../../../locales/nl.json";
import { Route } from "./index";

type View = NonNullable<
  FunctionReturnType<typeof gateway.library.getPuzzleDefinitionView>
>;

const PUZZLE_ID = "puzzle_1";

const mocks = vi.hoisted(() => ({
  // Query results keyed by Convex function name.
  data: new Map<string, unknown>(),
  // The paged review list.
  reviews: { results: [] as unknown[], status: "Exhausted" },
  loadMoreReviews: vi.fn<(count: number) => void>(),
  favorited: false,
  push: vi.fn<(href: string) => void>(),
  postReview: vi.fn<(args: unknown) => Promise<unknown>>(),
  toastSuccess: vi.fn<(message: string) => void>(),
  toastError: vi.fn<(message: string) => void>(),
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute:
    () =>
    <T,>(options: T) => ({ options, useParams: () => ({ id: PUZZLE_ID }) }),
  Link: ({
    to,
    search,
    children,
    ...rest
  }: {
    to: string;
    search?: Record<string, string>;
    children?: ReactNode;
  }) => (
    <a href={`${to}?${new URLSearchParams(search).toString()}`} {...rest}>
      {children}
    </a>
  ),
  useNavigate: () => vi.fn(),
}));
vi.mock("convex-helpers/react", () => ({
  usePaginatedQuery: () => ({
    ...mocks.reviews,
    loadMore: mocks.loadMoreReviews,
  }),
}));
vi.mock("@/compat/navigation", () => ({
  useRouter: () => ({ push: mocks.push }),
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
vi.mock("@tanstack/react-query", () => ({
  useQuery: ({ queryKey }: { queryKey: [string] }) => ({
    data: mocks.data.get(queryKey[0]),
    isError: false,
  }),
  // The only mutation on the page is posting a review.
  useMutation: () => ({ isPending: false, mutateAsync: mocks.postReview }),
}));
vi.mock("@convex-dev/react-query", async () => {
  const { getFunctionName: name } = await import("convex/server");
  return {
    convexQuery: (ref: Parameters<typeof name>[0]) => ({
      queryKey: [name(ref)],
    }),
    useConvexMutation: () => vi.fn(),
  };
});
vi.mock("@/hooks/use-favorites", () => ({
  useFavorites: () => ({
    isLoading: false,
    isFavorite: () => mocks.favorited,
    toggleFavorite: () => Promise.resolve(null),
  }),
}));
vi.mock("sonner", () => ({
  toast: { success: mocks.toastSuccess, error: mocks.toastError },
}));
vi.mock("@/hooks/use-box-art-check", () => ({
  useBoxArtInCheck: () => new Set<string>(),
}));
vi.mock("@/components/common/image-zoom", () => ({
  ImageZoom: ({ alt }: { alt: string }) => <img alt={alt} />,
}));

// A puzzle nobody has rated, finished or offered yet: the common case in the catalogue.
function emptyView(): View {
  return {
    definition: {
      title: "Café",
      brand: "Goliath",
      pieceCount: 1000,
      difficulty: "medium",
      tags: [],
    },
    rating: {
      rating: 0,
      count: 0,
      breakdown: [0, 0, 0, 0, 0],
      percentages: [0, 0, 0, 0, 0],
    },
    stats: {
      communityOwners: 1,
      totalCompletions: 0,
      avgCompletionDays: null,
      availableToSwap: 0,
    },
    ownership: { viewerOwns: false, copyId: null, condition: null },
    availableCopies: [],
    totalAvailable: 0,
  };
}

function offeredCopy(
  copyId: string,
  avgRating: number | null,
): View["availableCopies"][number] {
  return {
    copyId,
    swapType: "swap",
    owner: {
      name: "Sander",
      location: "Leusden",
      avatarUrl: null,
      avgRating,
    },
  };
}

function setView(view: View) {
  mocks.data.set(
    getFunctionName(gateway.library.getPuzzleDefinitionView),
    view,
  );
}

const renderPage = (locale: "en" | "nl" = "en") => {
  const Page = Route.options.component!;
  return render(
    <IntlProvider
      locale={locale}
      messages={locale === "en" ? en : nl}
      timeZone="Europe/Amsterdam"
    >
      <Page />
    </IntlProvider>,
  );
};

beforeEach(() => {
  mocks.data.clear();
  mocks.favorited = false;
  mocks.postReview.mockReset().mockResolvedValue(null);
  mocks.toastSuccess.mockReset();
  mocks.toastError.mockReset();
  mocks.reviews = { results: [], status: "Exhausted" };
  mocks.data.set(getFunctionName(gateway.identity.currentUser), null);
  mocks.data.set(getFunctionName(gateway.solving.getMyReviews), {
    puzzle: null,
  });
});

afterEach(cleanup);

const t = en.puzzleDefinition;

describe("puzzle detail page: missing data", () => {
  it("never renders placeholder numbers when nobody has rated, finished or offered it", () => {
    setView({
      ...emptyView(),
      availableCopies: [offeredCopy("copy_1", null)],
      totalAvailable: 1,
    });
    renderPage();

    const text = document.body.textContent ?? "";
    expect(text).not.toContain("—d");
    expect(text).not.toContain("0 (0)");
    expect(text).not.toContain("★ —");
    expect(text).not.toContain("0%");
    // The average completion says it is unknown instead of showing a fake value.
    expect(screen.getByText(t.noValue)).toBeTruthy();
    // The owner row keeps the location and leaves the missing rating out.
    expect(screen.getByText("Leusden")).toBeTruthy();
  });

  it("says nobody has rated it yet and offers to rate it in the review form", () => {
    setView(emptyView());
    renderPage();

    expect(screen.getAllByText(t.noRatingsYet).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: t.beFirstToRate }));
    // The rating comes first in the composer and is the part a review needs.
    expect(document.activeElement).toBe(
      screen.getByRole("radio", { name: "1 star" }),
    );
  });

  it("offers no way to rate a puzzle that can't be reviewed", () => {
    setView(emptyView());
    mocks.data.set(getFunctionName(gateway.solving.getMyReviews), {
      puzzle: null,
      puzzleReviewAllowed: false,
    });
    renderPage();

    expect(screen.getAllByText(t.noRatingsYet).length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: t.beFirstToRate })).toBeNull();
    expect(screen.queryByRole("button", { name: t.writeReview })).toBeNull();
    expect(screen.getByText(t.reviewNotOpen)).toBeTruthy();
  });

  it("shows the score, histogram, average and owner rating once they exist", () => {
    setView({
      ...emptyView(),
      rating: {
        rating: 4.5,
        count: 2,
        breakdown: [1, 1, 0, 0, 0],
        percentages: [50, 50, 0, 0, 0],
      },
      stats: { ...emptyView().stats, avgCompletionDays: 3 },
      availableCopies: [offeredCopy("copy_1", 4.8)],
      totalAvailable: 1,
    });
    renderPage();

    const text = document.body.textContent ?? "";
    expect(text).toContain("3d");
    expect(text).toContain("4.5 (2)");
    expect(text).toContain("50%");
    expect(text).toContain("Leusden · ★ 4.8");
    expect(screen.queryByText(t.noRatingsYet)).toBeNull();
  });
});

describe("puzzle detail page: available copies link", () => {
  const withCopies = (total: number): View => ({
    ...emptyView(),
    availableCopies: [offeredCopy("copy_1", null)],
    totalAvailable: total,
    stats: { ...emptyView().stats, availableToSwap: total },
  });

  it("names a single copy instead of saying 'all 1'", () => {
    setView(withCopies(1));
    renderPage();

    expect(
      screen.getByRole("link", { name: "View the available copy →" }),
    ).toBeTruthy();
  });

  it("counts several copies", () => {
    setView(withCopies(3));
    renderPage();

    expect(
      screen.getByRole("link", { name: "See all 3 available copies →" }),
    ).toBeTruthy();
  });

  it("uses the singular in Dutch too", () => {
    setView(withCopies(1));
    renderPage("nl");

    expect(
      screen.getByRole("link", { name: "Bekijk het beschikbare exemplaar →" }),
    ).toBeTruthy();
  });
});

describe("puzzle detail page: actions", () => {
  const tCatalog = en.puzzles.puzzles;
  // The brand (primary) button variant paints a gradient background.
  const isPrimary = (el: HTMLElement) =>
    el.className.includes("linear-gradient");

  it("leads with the member's own copy when they already own the puzzle", () => {
    setView({
      ...emptyView(),
      ownership: { viewerOwns: true, copyId: "copy_9", condition: "good" },
    });
    renderPage();

    const viewCopy = screen.getByRole("link", { name: t.viewYourCopy });
    // The owner's frame of the copy: My Library › My Puzzles › <name>, not Browse's.
    expect(viewCopy.getAttribute("href")).toBe("/my-puzzles/copy_9");
    // It is the primary action, ahead of adding another copy, and the only link to the copy.
    const addAnother = screen.getByRole("button", {
      name: en.puzzles.addToLibrary,
    });
    expect(isPrimary(viewCopy)).toBe(true);
    expect(isPrimary(addAnother)).toBe(false);
    expect(
      viewCopy.compareDocumentPosition(addAnother) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(screen.getAllByRole("link", { name: t.viewYourCopy })).toHaveLength(
      1,
    );
  });

  it("leads with adding the puzzle when the member does not own it", () => {
    setView(emptyView());
    renderPage();

    expect(screen.queryByRole("link", { name: t.viewYourCopy })).toBeNull();
    expect(
      isPrimary(screen.getByRole("button", { name: en.puzzles.addToLibrary })),
    ).toBe(true);
  });

  it("disables finding a copy, and says why, when nobody offers one", () => {
    setView(emptyView());
    renderPage();

    const find = screen.getByRole("button", { name: t.findCopyToSwap });
    expect((find as HTMLButtonElement).disabled).toBe(true);
    const hintId = find.getAttribute("aria-describedby");
    expect(hintId).toBeTruthy();
    expect(document.getElementById(hintId!)?.textContent).toBe(
      t.noCopiesOffered,
    );
  });

  it("says nobody else offers it when the viewer owns the puzzle", () => {
    setView({
      ...emptyView(),
      ownership: { viewerOwns: true, copyId: "copy_9", condition: "good" },
    });
    renderPage();

    const find = screen.getByRole("button", { name: t.findCopyToSwap });
    const hintId = find.getAttribute("aria-describedby");
    expect(document.getElementById(hintId!)?.textContent).toBe(
      t.noOtherCopiesOffered,
    );
    expect(screen.getByText(t.noOtherCopies)).toBeTruthy();
    expect(screen.queryByText(t.noCopies)).toBeNull();
    expect(screen.queryByText(t.noCopiesOffered)).toBeNull();
  });

  it("lets the member find a copy when one is offered", () => {
    setView({
      ...emptyView(),
      availableCopies: [offeredCopy("copy_1", null)],
      totalAvailable: 1,
    });
    renderPage();

    const find = screen.getByRole("button", { name: t.findCopyToSwap });
    expect((find as HTMLButtonElement).disabled).toBe(false);
    expect(find.getAttribute("aria-describedby")).toBeNull();
    expect(screen.queryByText(t.noCopiesOffered)).toBeNull();
  });

  it("shows no difficulty badge for a puzzle without a difficulty", () => {
    const view = emptyView();
    const { difficulty: _difficulty, ...definition } = view.definition;
    setView({ ...view, definition });
    renderPage();
    expect(
      screen.queryByText(en.puzzles.puzzles.difficulty.unknown),
    ).toBeNull();
  });

  it("makes favourite a named toggle that reports its state", () => {
    setView(emptyView());
    renderPage();
    expect(
      screen
        .getByRole("button", { name: t.favorite })
        .getAttribute("aria-pressed"),
    ).toBe("false");
    cleanup();

    mocks.favorited = true;
    renderPage();
    expect(
      screen
        .getByRole("button", { name: t.favorite })
        .getAttribute("aria-pressed"),
    ).toBe("true");
    // The old labelled button is gone; its wording now only lives in the tooltip.
    expect(
      screen.queryByRole("button", { name: tCatalog.removeFromFavorites }),
    ).toBeNull();
  });

  it("links to suggesting an edit", () => {
    setView(emptyView());
    renderPage();

    expect(
      screen.getByRole("link", { name: t.suggestEdit }).getAttribute("href"),
    ).toBe(`/puzzles/${PUZZLE_ID}/suggest-edit`);
  });
});

describe("puzzle detail page: wording", () => {
  it("opens with the puzzle's name, not an internal 'puzzle definition' label", () => {
    setView(emptyView());
    renderPage();

    expect(document.body.textContent).not.toMatch(/definition/i);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Café");
  });
});

describe("puzzle detail page: review composer", () => {
  const post = () => screen.getByRole("button", { name: t.post });
  const group = () => screen.getByRole("radiogroup", { name: t.yourRating });

  it("asks for the required rating first, then the optional text, then Post", () => {
    setView(emptyView());
    renderPage();

    const stars = group();
    const text = screen.getByRole("textbox");
    expect(stars.getAttribute("aria-required")).toBe("true");
    // A visible label, not only the group's accessible name.
    expect(screen.getByText(t.yourRating)).toBeTruthy();
    expect(text.getAttribute("placeholder")).toBe(t.reviewPlaceholder);
    expect(
      stars.compareDocumentPosition(text) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      text.compareDocumentPosition(post()) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("writes a review in a multi-line field where Enter is a new line, not Post", () => {
    setView(emptyView());
    renderPage();
    fireEvent.click(screen.getByRole("radio", { name: /^4/ }));

    const text = screen.getByRole("textbox");
    expect(text.tagName).toBe("TEXTAREA");
    fireEvent.change(text, { target: { value: "First line" } });
    // Not prevented: the browser inserts the line break.
    expect(fireEvent.keyDown(text, { key: "Enter" })).toBe(true);
    expect(mocks.postReview).not.toHaveBeenCalled();
  });

  it("says a rating is needed to post until one is chosen", () => {
    setView(emptyView());
    renderPage();

    expect((post() as HTMLButtonElement).disabled).toBe(true);
    const hintId = group().getAttribute("aria-describedby");
    expect(hintId).toBeTruthy();
    expect(document.getElementById(hintId!)?.textContent).toBe(
      t.chooseRatingToPost,
    );
    expect(post().getAttribute("aria-describedby")).toBe(hintId);

    fireEvent.click(screen.getByRole("radio", { name: "4 stars" }));
    expect((post() as HTMLButtonElement).disabled).toBe(false);
    expect(screen.queryByText(t.chooseRatingToPost)).toBeNull();
    expect(group().getAttribute("aria-describedby")).toBeNull();
    expect(post().getAttribute("aria-describedby")).toBeNull();
  });

  it("confirms a posted review", async () => {
    setView(emptyView());
    renderPage();

    fireEvent.click(screen.getByRole("radio", { name: "4 stars" }));
    fireEvent.click(post());
    await waitFor(() =>
      expect(mocks.toastSuccess).toHaveBeenCalledWith(t.reviewPosted),
    );
    expect(mocks.postReview).toHaveBeenCalledWith({
      puzzleId: PUZZLE_ID,
      rating: 4,
    });
    expect(mocks.toastError).not.toHaveBeenCalled();
  });

  it("confirms an updated review", async () => {
    mocks.data.set(getFunctionName(gateway.solving.getMyReviews), {
      puzzle: { rating: 3, text: "Lovely" },
    });
    setView(emptyView());
    renderPage();

    const update = screen.getByRole("button", { name: t.updateReview });
    expect(
      screen
        .getByRole("radio", { name: "3 stars" })
        .getAttribute("aria-checked"),
    ).toBe("true");
    fireEvent.click(update);
    await waitFor(() =>
      expect(mocks.toastSuccess).toHaveBeenCalledWith(t.reviewUpdated),
    );
    expect(mocks.postReview).toHaveBeenCalledWith({
      puzzleId: PUZZLE_ID,
      rating: 3,
      text: "Lovely",
    });
  });

  it("does not confirm a review that failed to post", async () => {
    mocks.postReview.mockRejectedValue(new Error("offline"));
    setView(emptyView());
    renderPage();

    fireEvent.click(screen.getByRole("radio", { name: "2 stars" }));
    fireEvent.click(post());
    await waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith(t.reviewFailed),
    );
    expect(mocks.toastSuccess).not.toHaveBeenCalled();
  });

  it("reads naturally in Dutch", () => {
    setView(emptyView());
    renderPage("nl");

    const tNl = nl.puzzleDefinition;
    expect(
      screen.getByRole("radiogroup", { name: tNl.yourRating }),
    ).toBeTruthy();
    expect(screen.getByText(tNl.chooseRatingToPost)).toBeTruthy();
    expect(screen.getByRole("radio", { name: "3 sterren" })).toBeTruthy();
  });
});

describe("puzzle detail page: reviews come a page at a time", () => {
  const review = (id: string, text: string) => ({
    id,
    author: { anonymous: true, anonRef: id },
    rating: 4,
    text,
    updatedAt: 1,
    canDelete: false,
  });

  it("says the count is partial while more remain, and Show more asks for them", () => {
    setView(emptyView());
    mocks.reviews = {
      results: [review("r1", "Lovely box")],
      status: "CanLoadMore",
    };
    renderPage();
    expect(screen.getByText("Lovely box")).toBeTruthy();
    expect(screen.getByText("1+")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: t.showMoreReviews }));
    expect(mocks.loadMoreReviews).toHaveBeenCalledWith(20);
  });

  it("says there are none only once it knows, and offers no more at the end", () => {
    setView(emptyView());
    mocks.reviews = { results: [], status: "LoadingFirstPage" };
    const { unmount } = renderPage();
    expect(screen.queryByText(t.noReviews)).toBeNull();
    unmount();

    mocks.reviews = { results: [], status: "Exhausted" };
    renderPage();
    expect(screen.getByText(t.noReviews)).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: t.showMoreReviews }),
    ).toBeNull();
  });
});
