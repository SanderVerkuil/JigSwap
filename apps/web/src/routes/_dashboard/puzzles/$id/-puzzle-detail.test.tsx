// @vitest-environment happy-dom
// The "-" prefix keeps the TanStack route generator from treating this file as a route.
import { gateway } from "@/gateway";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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
  favorited: false,
  push: vi.fn<(href: string) => void>(),
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
  useMutation: () => ({ isPending: false, mutateAsync: vi.fn() }),
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
  mocks.data.set(getFunctionName(gateway.social.listPuzzleReviews), []);
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
    expect(document.activeElement).toBe(screen.getByRole("textbox"));
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
