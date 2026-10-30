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
        <PuzzleViewProvider viewMode="grid">
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
    const offer = [...host.querySelectorAll("[data-slot=badge]")].find(
      (el) => el.textContent === "For Trade",
    )!;
    expect(offer.parentElement!.classList).toContain("flex-wrap");
  });
});

describe("PuzzleCard (browse)", () => {
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
});
