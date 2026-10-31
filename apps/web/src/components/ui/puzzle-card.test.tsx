// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import type { ComponentProps, ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { IntlProvider } from "use-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import en from "../../../locales/en.json";
import nl from "../../../locales/nl.json";
import { PuzzleCard, PuzzleViewProvider } from "./puzzle-card";

// A copy card tells its three kinds of facts apart at a glance: what the copy is offered for
// (tinted chips, each with its own icon), its condition (a coloured dot and the condition's
// word, announced as the condition), and the puzzle's tags (plain "#tag" text).

// Router-free Link: these tests assert card layout and actions, not routing.
vi.mock("@/compat/link", () => {
  const Link = ({
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
  );
  return { Link, default: Link };
});
vi.mock("@/hooks/use-box-art-check", () => ({
  useBoxArtInCheck: () => new Set<string>(),
}));
vi.mock("@/components/ui/collection-dropdown", () => ({
  CollectionMenuItems: () => null,
}));

type CardProps = ComponentProps<typeof PuzzleCard>;

const copy: CardProps["puzzle"] = {
  _id: "copy_1",
  puzzleId: "puzzle_1",
  condition: "good",
  availability: { forTrade: true, forLend: false, forSale: false },
  createdAt: 1,
  updatedAt: 1,
  puzzle: {
    _id: "puzzle_1",
    title: "Café",
    brand: "Goliath",
    pieceCount: 1000,
    difficulty: "medium",
    createdAt: 1,
    updatedAt: 1,
  },
};

// The box-art read never resolves here: the card renders its placeholder.
const pendingQueryClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: { retry: false, queryFn: () => new Promise<never>(() => {}) },
    },
  });

const renderCard = (
  props: Partial<CardProps> = {},
  locale: "en" | "nl" = "en",
  viewMode: "grid" | "list" = "grid",
) => {
  const queryClient = pendingQueryClient();
  const handlers = {
    onRequestExchange: vi.fn(),
    onMessage: vi.fn(),
    onFavorite: vi.fn(),
  };
  const view = render(
    <QueryClientProvider client={queryClient}>
      <IntlProvider
        locale={locale}
        messages={locale === "en" ? en : nl}
        timeZone="Europe/Amsterdam"
      >
        <PuzzleViewProvider viewMode={viewMode}>
          <PuzzleCard
            puzzle={copy}
            variant="browse"
            ownerLabel="Sander Verkuil"
            {...handlers}
            {...props}
          />
        </PuzzleViewProvider>
      </IntlProvider>
    </QueryClientProvider>,
  );
  return { ...view, handlers };
};

afterEach(cleanup);

describe("owned-copy PuzzleCard", () => {
  it("wraps the offer badges, which do not fit one row of a compact phone card", () => {
    const host = document.createElement("div");
    host.innerHTML = renderToStaticMarkup(
      <QueryClientProvider client={pendingQueryClient()}>
        <IntlProvider locale="en" messages={en} timeZone="Europe/Amsterdam">
          <PuzzleViewProvider viewMode="grid">
            <PuzzleCard
              puzzle={{
                ...copy,
                availability: { forLend: true, forTrade: true, forSale: true },
              }}
            />
          </PuzzleViewProvider>
        </IntlProvider>
      </QueryClientProvider>,
    );
    const offers = host.querySelector("[data-testid=copy-offers]")!;
    expect(offers.classList).toContain("flex-wrap");
  });
});

describe("PuzzleCard (browse)", () => {
  it("doesn't stretch Request across a wide list row, only across a phone's", () => {
    renderCard({}, "en", "list");
    const request = screen.getByRole("button", { name: "Request" });
    expect(request.className).toContain("sm:flex-none");
    expect(request.className).toContain("flex-1");
    cleanup();

    renderCard({}, "en", "grid");
    expect(
      screen.getByRole("button", { name: "Request" }).className,
    ).not.toContain("sm:flex-none");
  });

  it("names every action button, each differently", () => {
    renderCard();
    const names = screen
      .getAllByRole("button")
      .map((button) => button.getAttribute("aria-label") ?? button.textContent);
    expect(names).toEqual(["Request", "Message Sander Verkuil", "Favorite"]);
  });

  it("runs the matching action for each button", () => {
    const { handlers } = renderCard();
    fireEvent.click(screen.getByRole("button", { name: "Request" }));
    expect(handlers.onRequestExchange).toHaveBeenCalledWith("copy_1");
    fireEvent.click(
      screen.getByRole("button", { name: "Message Sander Verkuil" }),
    );
    expect(handlers.onMessage).toHaveBeenCalledWith("copy_1");
    fireEvent.click(screen.getByRole("button", { name: "Favorite" }));
    expect(handlers.onFavorite).toHaveBeenCalledWith("copy_1");
  });

  it("shows whether the puzzle is a favourite on the heart, under one stable name", () => {
    renderCard({ favorited: false });
    expect(
      screen
        .getByRole("button", { name: "Favorite" })
        .getAttribute("aria-pressed"),
    ).toBe("false");
    cleanup();
    renderCard({ favorited: true });
    expect(
      screen
        .getByRole("button", { name: "Favorite" })
        .getAttribute("aria-pressed"),
    ).toBe("true");
  });

  it("names the actions in Dutch", () => {
    renderCard({}, "nl");
    expect(screen.getByRole("button", { name: "Aanvragen" })).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Bericht sturen aan Sander Verkuil" }),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Favoriet" })).toBeTruthy();
  });

  it("offers only the actions it is given", () => {
    renderCard({ onRequestExchange: undefined, onMessage: undefined });
    const names = within(document.body)
      .getAllByRole("button")
      .map((button) => button.getAttribute("aria-label") ?? button.textContent);
    expect(names).toEqual(["Favorite"]);
  });

  it("says whose copy it is and how it is offered before its condition", () => {
    renderCard();
    const owner = screen.getByText("Sander Verkuil");
    const offer = screen.getByText("For Trade");
    const condition = screen.getByText("Good");
    const follows = (a: Node, b: Node) =>
      (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
    expect(follows(owner, offer)).toBe(true);
    expect(follows(offer, condition)).toBe(true);
  });
});

type CardCopy = ComponentProps<typeof PuzzleCard>["puzzle"];

const ownedCopy = (extra: Partial<CardCopy> = {}): CardCopy => ({
  _id: "copy_1",
  aggregateId: "copy_agg_1",
  puzzleId: "puzzle_1",
  condition: "like_new",
  availability: { forTrade: true, forLend: true, forSale: false },
  visibility: "visible",
  createdAt: 0,
  updatedAt: 0,
  coverUrl: null,
  puzzle: {
    _id: "puzzle_1",
    title: "De Kattenshow",
    pieceCount: 1000,
    tags: ["cats", "comic", "dutch", "busy"],
    createdAt: 0,
    updatedAt: 0,
  },
  ...extra,
});

const renderOwnedCard = (
  props: Partial<ComponentProps<typeof PuzzleCard>> = {},
) =>
  render(
    <IntlProvider locale="en" messages={en} timeZone="Europe/Amsterdam">
      <PuzzleViewProvider viewMode="grid">
        <PuzzleCard
          puzzle={ownedCopy()}
          viewBasePath="/my-puzzles"
          {...props}
        />
      </PuzzleViewProvider>
    </IntlProvider>,
  );

describe("copy card badges", () => {
  it("shows each offer as a chip with its own icon, and nothing for offers that are off", () => {
    renderOwnedCard();
    expect(screen.getByTestId("copy-offers")).toBeTruthy();
    const trade = screen.getByText("For Trade");
    const lend = screen.getByText("For Loan");
    expect(trade.querySelector("svg.lucide-arrow-left-right")).toBeTruthy();
    expect(lend.querySelector("svg.lucide-package")).toBeTruthy();
    expect(screen.queryByText("For Sale")).toBeNull();
  });

  it("names the condition with the shared word and a coloured dot, announced as the condition", () => {
    renderOwnedCard();
    const condition = screen.getByTestId("copy-condition");
    expect(condition.textContent).toBe("Condition: Like new");
    expect(condition.querySelector(".sr-only")?.textContent).toBe(
      "Condition: ",
    );
    expect(condition.querySelector(".bg-jigsaw-secondary")).toBeTruthy();
  });

  it("shows tags as plain #tag text, not as chips", () => {
    renderOwnedCard();
    expect(screen.getByText("#cats")).toBeTruthy();
    expect(screen.getByText("#dutch")).toBeTruthy();
    expect(screen.queryByText("#busy")).toBeNull();
    expect(screen.getByText("+1")).toBeTruthy();
    expect(screen.getByText("#cats").closest("[data-slot='badge']")).toBeNull();
  });

  it("shows no offer row when nothing is offered", () => {
    renderOwnedCard({
      puzzle: ownedCopy({
        availability: { forTrade: false, forLend: false, forSale: false },
      }),
    });
    expect(screen.queryByTestId("copy-offers")).toBeNull();
  });
});

describe("copy card menu", () => {
  const openMenu = () =>
    fireEvent.pointerDown(
      screen.getByRole("button", { name: "Puzzle actions" }),
      {
        button: 0,
        ctrlKey: false,
      },
    );

  it("offers a collection's owner Remove from this collection in the ⋯ menu, not a one-tap trash", () => {
    const onRemove = vi.fn();
    renderCard({ variant: "collection", onRemove });
    expect(
      screen.queryByRole("button", { name: "Remove from this collection" }),
    ).toBeNull();
    openMenu();
    const remove = screen.getByRole("menuitem", {
      name: "Remove from this collection",
    });
    expect(remove.querySelector("svg.lucide-folder-minus")).toBeTruthy();
    expect(remove.querySelector("svg.lucide-trash-2")).toBeNull();
    expect(onRemove).not.toHaveBeenCalled();
    fireEvent.click(remove);
    expect(onRemove).toHaveBeenCalledWith("copy_1");
  });

  it("shows no menu on a collection card the viewer can't change", () => {
    renderCard({ variant: "collection" });
    expect(screen.queryByRole("button", { name: "Puzzle actions" })).toBeNull();
  });

  it("marks Start puzzle with a play icon, unlike Log a solve", () => {
    renderOwnedCard({ onLogSolve: () => {}, onStartSolve: () => {} });
    openMenu();
    const log = screen.getByRole("menuitem", { name: "Log a solve" });
    const start = screen.getByRole("menuitem", { name: "Start puzzle" });
    expect(log.querySelector("svg.lucide-circle-check")).toBeTruthy();
    expect(start.querySelector("svg.lucide-play")).toBeTruthy();
  });
});
