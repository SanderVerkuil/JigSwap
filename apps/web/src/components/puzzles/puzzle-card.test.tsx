// @vitest-environment happy-dom
import { PuzzleCard as CopyCard } from "@/components/ui/puzzle-card";
import { screen } from "@testing-library/react";
import type { ComponentProps, ReactNode } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { IntlProvider } from "use-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import en from "../../../locales/en.json";
import nl from "../../../locales/nl.json";
import { PuzzleCard as CatalogCard } from "./puzzle-card";
import {
  PUZZLE_GRID_COVER_SIZES,
  PuzzleViewProvider,
} from "./puzzle-view-provider";

// The cards' data hooks and the router are out of scope: the tests assert the card's DOM.
vi.mock("@/gateway", () => ({ gateway: {} }));
vi.mock("@/hooks/use-favorites", () => ({
  useFavorites: () => ({
    isLoading: false,
    isFavorite: () => false,
    toggleFavorite: async () => {},
  }),
}));
vi.mock("@/hooks/use-box-art-check", () => ({
  useBoxArtInCheck: () => new Set<string>(),
}));
vi.mock("@/components/ui/collection-dropdown", () => ({
  CollectionMenuItems: () => null,
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

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const SRC_SET =
  "https://cdn.test/480 480w, https://cdn.test/960 960w, https://cdn.test/original 1600w";

const render = (
  node: ReactNode,
  viewMode: "grid" | "list" = "grid",
  locale: "en" | "nl" = "en",
) =>
  act(() =>
    root.render(
      <IntlProvider
        locale={locale}
        timeZone="UTC"
        messages={locale === "en" ? en : nl}
      >
        <PuzzleViewProvider viewMode={viewMode}>{node}</PuzzleViewProvider>
      </IntlProvider>,
    ),
  );

const cover = () => {
  const img = container.querySelector("img");
  if (!img) throw new Error("no cover <img>");
  return img;
};

type Summary = ComponentProps<typeof CatalogCard>["puzzle"];

const summary = (extra: Partial<Summary> = {}): Summary => ({
  _id: "p1",
  _creationTime: 0,
  title: "Harbour at dusk",
  pieceCount: 1000,
  image: "https://cdn.test/original",
  status: "approved",
  createdAt: 0,
  updatedAt: 0,
  ...extra,
});

describe("catalogue PuzzleCard cover", () => {
  it("lets the browser pick a rendition for the app's puzzle grid", () => {
    render(<CatalogCard puzzle={summary({ imageSrcSet: SRC_SET })} />);
    expect(cover().getAttribute("src")).toBe("https://cdn.test/original");
    expect(cover().getAttribute("srcset")).toBe(SRC_SET);
    expect(cover().getAttribute("sizes")).toBe(PUZZLE_GRID_COVER_SIZES);
  });

  it("uses the list view's thumbnail in list view", () => {
    render(<CatalogCard puzzle={summary({ imageSrcSet: SRC_SET })} />, "list");
    expect(cover().getAttribute("sizes")).toBe("56px");
  });

  it("shows the original alone before renditions exist", () => {
    render(<CatalogCard puzzle={summary()} />);
    expect(cover().getAttribute("src")).toBe("https://cdn.test/original");
    expect(cover().hasAttribute("srcset")).toBe(false);
    expect(cover().hasAttribute("sizes")).toBe(false);
  });
});

type Copy = ComponentProps<typeof CopyCard>["puzzle"];

const copy = (extra: Partial<Copy> = {}): Copy => ({
  _id: "c1",
  puzzleId: "p1",
  condition: "good",
  availability: { forTrade: false, forSale: false, forLend: false },
  createdAt: 0,
  updatedAt: 0,
  puzzle: {
    _id: "p1",
    title: "Harbour at dusk",
    pieceCount: 1000,
    createdAt: 0,
    updatedAt: 0,
  },
  coverUrl: "https://cdn.test/480",
  ...extra,
});

describe("owned-copy PuzzleCard cover", () => {
  it("lets the browser pick a rendition for the app's puzzle grid", () => {
    render(<CopyCard puzzle={copy({ coverSrcSet: SRC_SET })} />);
    expect(cover().getAttribute("srcset")).toBe(SRC_SET);
    expect(cover().getAttribute("sizes")).toBe(PUZZLE_GRID_COVER_SIZES);
  });

  it("takes the caller's sizes for a grid of its own", () => {
    render(
      <CopyCard puzzle={copy({ coverSrcSet: SRC_SET })} imageSizes="214px" />,
    );
    expect(cover().getAttribute("sizes")).toBe("214px");
  });

  it("uses the list view's thumbnail in list view", () => {
    render(<CopyCard puzzle={copy({ coverSrcSet: SRC_SET })} />, "list");
    expect(cover().getAttribute("sizes")).toBe("56px");
  });

  it("shows the cover alone without renditions (a cover photo, or before the backfill)", () => {
    render(<CopyCard puzzle={copy({ coverUrl: "https://cdn.test/photo" })} />);
    expect(cover().getAttribute("src")).toBe("https://cdn.test/photo");
    expect(cover().hasAttribute("srcset")).toBe(false);
    expect(cover().hasAttribute("sizes")).toBe(false);
  });
});

describe("catalogue PuzzleCard on phones", () => {
  it("sizes the cover for the two-column phone grid, not the full viewport", () => {
    render(<CatalogCard puzzle={summary({ imageSrcSet: SRC_SET })} />);
    expect(container.querySelector(".grid-cols-2")).toBeTruthy();
    expect(cover().getAttribute("sizes")).toContain("(max-width: 639px) 50vw");
  });

  it("offers no View Details button in the compact card; the title link opens the puzzle", () => {
    const host = document.createElement("div");
    host.innerHTML = renderToStaticMarkup(
      <IntlProvider locale="en" messages={en} timeZone="Europe/Amsterdam">
        <PuzzleViewProvider viewMode="grid">
          <CatalogCard puzzle={summary({ title: "Lam Gelegd" })} />
        </PuzzleViewProvider>
      </IntlProvider>,
    );
    const links = [...host.querySelectorAll("a")];
    expect(
      links.some(
        (a) =>
          a.getAttribute("href") === "/puzzles/p1" &&
          a.textContent === "Lam Gelegd",
      ),
    ).toBe(true);
    // Gone at every width: two ~170px columns left it "V…".
    expect(
      links.filter((a) => a.textContent?.includes("View Details")),
    ).toEqual([]);
  });
});

describe("catalogue PuzzleCard", () => {
  it("links to the puzzle once, through its title", () => {
    render(<CatalogCard puzzle={summary()} />);
    const detailLinks = container.querySelectorAll('a[href="/puzzles/p1"]');
    expect(detailLinks).toHaveLength(1);
    expect(detailLinks[0]?.textContent).toBe("Harbour at dusk");
  });

  it("keeps the named favourite and add actions", () => {
    render(<CatalogCard puzzle={summary()} />);
    expect(
      screen
        .getByRole("button", { name: "Add to Favorites" })
        .getAttribute("aria-pressed"),
    ).toBe("false");
    expect(
      screen.getByRole("link", { name: "Add to Library" }).getAttribute("href"),
    ).toBe("/my-puzzles/add/new?puzzleId=p1");
  });

  it("says the + adds a copy to the library, in Dutch too", () => {
    render(<CatalogCard puzzle={summary()} />, "grid", "nl");
    expect(
      screen
        .getByRole("link", { name: "Toevoegen aan bibliotheek" })
        .getAttribute("href"),
    ).toBe("/my-puzzles/add/new?puzzleId=p1");
  });
});
