// @vitest-environment happy-dom
import type { gateway } from "@/gateway";
import { cleanup, render, screen, within } from "@testing-library/react";
import type { FunctionReturnType } from "convex/server";
import type { ReactNode } from "react";
import { IntlProvider } from "use-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import en from "../../../locales/en.json";
import nl from "../../../locales/nl.json";
import { PuzzleCard } from "./puzzle-card";
import { PuzzlePickList } from "./puzzle-pick-list";
import { PuzzleViewProvider } from "./puzzle-view-provider";

const mocks = vi.hoisted(() => ({
  useFavorites: vi.fn(() => ({
    isFavorite: () => false,
    toggleFavorite: async () => {},
  })),
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
vi.mock("@/hooks/use-box-art-check", () => ({
  useBoxArtInCheck: () => new Set<string>(),
}));
vi.mock("@/hooks/use-favorites", () => ({ useFavorites: mocks.useFavorites }));

type Puzzle = FunctionReturnType<typeof gateway.catalog.recentPuzzles>[number];

const puzzle = (id: string, extra: Partial<Puzzle> = {}): Puzzle => ({
  _id: `doc_${id}`,
  _creationTime: 0,
  aggregateId: `def_${id}`,
  title: `Puzzle ${id}`,
  brand: "Ravensburger",
  pieceCount: 1000,
  image: null,
  status: "approved",
  createdAt: 0,
  updatedAt: 0,
  ...extra,
});

const withIntl = (children: ReactNode, locale: "en" | "nl" = "en") => (
  <IntlProvider
    locale={locale}
    messages={locale === "en" ? en : nl}
    timeZone="Europe/Amsterdam"
  >
    {children}
  </IntlProvider>
);

beforeEach(() => mocks.useFavorites.mockClear());
afterEach(cleanup);

describe("PuzzleCard variant='pick'", () => {
  const renderPick = (onShelf = false) =>
    render(
      withIntl(
        <PuzzleViewProvider viewMode="grid">
          <PuzzleCard variant="pick" puzzle={puzzle("a")} onShelf={onShelf} />
        </PuzzleViewProvider>,
      ),
    );

  it("opens the add-copy form from the whole card and from a labelled Add button", () => {
    renderPick();
    const addHref = "/my-puzzles/add/new?puzzleId=doc_a";
    expect(
      screen.getByRole("link", { name: "Puzzle a" }).getAttribute("href"),
    ).toBe(addHref);
    expect(
      screen.getByRole("link", { name: "Add to Library" }).getAttribute("href"),
    ).toBe(addHref);
  });

  it("keeps a small Details link to the catalogue page, named after the puzzle", () => {
    renderPick();
    const details = screen.getByRole("link", { name: "Details of Puzzle a" });
    expect(details.getAttribute("href")).toBe("/puzzles/doc_a");
    expect(details.textContent).toBe("Details");
  });

  it("has no favourite heart and reads no favourites", () => {
    renderPick();
    expect(screen.queryByRole("button")).toBeNull();
    expect(mocks.useFavorites).not.toHaveBeenCalled();
  });

  it("marks a puzzle already on the shelf", () => {
    renderPick(true);
    expect(screen.getByText("On your shelf")).toBeTruthy();
    cleanup();
    renderPick(false);
    expect(screen.queryByText("On your shelf")).toBeNull();
  });

  it("leaves the catalogue card as it was: the card opens the catalogue page", () => {
    render(
      withIntl(
        <PuzzleViewProvider viewMode="grid">
          <PuzzleCard puzzle={puzzle("a")} />
        </PuzzleViewProvider>,
      ),
    );
    expect(
      screen.getByRole("link", { name: "Puzzle a" }).getAttribute("href"),
    ).toBe("/puzzles/doc_a");
    expect(mocks.useFavorites).toHaveBeenCalled();
  });
});

describe("PuzzlePickList", () => {
  const renderList = (locale: "en" | "nl" = "en") =>
    render(
      withIntl(
        <PuzzlePickList
          puzzles={[
            puzzle("a"),
            puzzle("b"),
            puzzle("c", { aggregateId: undefined }),
          ]}
          ownedDefinitionIds={new Set(["def_b", "doc_c"])}
        />,
        locale,
      ),
    );

  it("renders phone rows that each open the add-copy form, with a Details link", () => {
    renderList();
    const rows = screen.getByTestId("pick-rows");
    expect(rows.className).toContain("sm:hidden");
    const add = within(rows).getByRole("link", { name: "Add Puzzle a" });
    expect(add.getAttribute("href")).toBe("/my-puzzles/add/new?puzzleId=doc_a");
    expect(add.className).toContain("min-h-12");
    expect(
      within(rows)
        .getByRole("link", { name: "Details of Puzzle a" })
        .getAttribute("href"),
    ).toBe("/puzzles/doc_a");
  });

  it("renders the pick cards from sm up", () => {
    renderList();
    const adds = screen.getAllByRole("link", { name: "Add to Library" });
    expect(adds).toHaveLength(3);
    const grid = adds[0].closest(".sm\\:grid");
    expect(grid?.className).toMatch(/(^| )hidden( |$)/);
    expect(adds.every((a) => grid?.contains(a))).toBe(true);
  });

  it("marks owned puzzles by their catalogue definition id only", () => {
    renderList();
    const rows = screen.getByTestId("pick-rows");
    const items = within(rows).getAllByRole("listitem");
    expect(
      items.map((li) => li.textContent?.includes("On your shelf")),
    ).toEqual([false, true, false]);
  });

  it("speaks Dutch", () => {
    renderList("nl");
    expect(
      screen.getByRole("link", { name: "Puzzle a toevoegen" }),
    ).toBeTruthy();
    expect(screen.getAllByText("Op je plank").length).toBeGreaterThan(0);
  });
});
