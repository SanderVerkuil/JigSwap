// @vitest-environment happy-dom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { IntlProvider } from "use-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import en from "../../../locales/en.json";
import { PuzzleCardShell, type PuzzleCardView } from "./puzzle-card-shell";
import { PuzzleViewProvider } from "./puzzle-view-provider";

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

const SRC = "https://cdn.test/original";
const SRC_SET =
  "https://cdn.test/480 480w, https://cdn.test/960 960w, https://cdn.test/original 1600w";
const GRID_SIZES = "(min-width: 1024px) 25vw, 50vw";

const puzzle = (extra: Partial<PuzzleCardView> = {}): PuzzleCardView => ({
  id: "p1",
  title: "Harbour at dusk",
  imageUrl: SRC,
  ...extra,
});

const render = (
  view: PuzzleCardView,
  viewMode: "grid" | "list",
  imageSizes?: string,
) =>
  act(() =>
    root.render(
      <IntlProvider locale="en" timeZone="UTC" messages={en}>
        <PuzzleViewProvider viewMode={viewMode}>
          <PuzzleCardShell puzzle={view} imageSizes={imageSizes} />
        </PuzzleViewProvider>
      </IntlProvider>,
    ),
  );

const cover = () => {
  const img = container.querySelector("img");
  if (!img) throw new Error("no cover image rendered");
  return img;
};

describe("PuzzleCardShell cover renditions", () => {
  it("offers the renditions with the grid's slot width in grid view", () => {
    render(puzzle({ imageSrcSet: SRC_SET }), "grid", GRID_SIZES);
    expect(cover().getAttribute("src")).toBe(SRC);
    expect(cover().getAttribute("srcset")).toBe(SRC_SET);
    expect(cover().getAttribute("sizes")).toBe(GRID_SIZES);
  });

  it("sizes the list view's cover to its fixed 128px column", () => {
    render(puzzle({ imageSrcSet: SRC_SET }), "list", GRID_SIZES);
    expect(cover().getAttribute("srcset")).toBe(SRC_SET);
    expect(cover().getAttribute("sizes")).toBe("128px");
  });

  it("renders the original alone, exactly as before, without renditions", () => {
    for (const imageSrcSet of [undefined, null]) {
      render(puzzle({ imageSrcSet }), "grid", GRID_SIZES);
      expect(cover().getAttribute("src")).toBe(SRC);
      expect(cover().hasAttribute("srcset")).toBe(false);
      expect(cover().hasAttribute("sizes")).toBe(false);
    }
  });

  it("keeps the no-image placeholder when there is no cover at all", () => {
    render(
      puzzle({ imageUrl: null, imageSrcSet: SRC_SET }),
      "grid",
      GRID_SIZES,
    );
    expect(container.querySelector("img")).toBeNull();
  });
});

// Router-free Link: the test asserts card layout classes, not routing.
vi.mock("@/compat/link", () => ({
  Link: ({ children, href }: { children?: ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

const densityPuzzle: PuzzleCardView = {
  id: "p1",
  title: "Lam Gelegd",
  brand: "Jumbo",
  pieceCount: 500,
  difficulty: "expert",
  description: "Sheep everywhere",
  tags: ["cartoon", "dieren"],
  imageUrl: "https://example.test/cover.jpg",
};

const renderDensity = (
  viewMode: "grid" | "list",
  imageFit: "cover" | "contain" = "contain",
) => {
  const host = document.createElement("div");
  host.innerHTML = renderToStaticMarkup(
    <IntlProvider locale="en" messages={en} timeZone="Europe/Amsterdam">
      <PuzzleViewProvider viewMode={viewMode}>
        <PuzzleCardShell
          puzzle={densityPuzzle}
          imageHref="/puzzles/p1"
          imageFit={imageFit}
        />
      </PuzzleViewProvider>
    </IntlProvider>,
  );
  const byText = (text: string) =>
    [...host.querySelectorAll("*")].find(
      (el) => el.children.length === 0 && el.textContent === text,
    )!;
  return {
    cover: host.querySelector("img")!.parentElement!.classList,
    // The content column is the card's second child in grid mode.
    content: byText("Sheep everywhere").parentElement!.classList,
    description: byText("Sheep everywhere").classList,
    tags: byText("#cartoon").parentElement!.classList,
  };
};

describe("PuzzleCardShell density", () => {
  it("is compact below sm in grid mode: 4:3 cover, tighter padding, no description or tags", () => {
    const card = renderDensity("grid");
    expect(card.cover).toContain("aspect-[4/3]");
    expect(card.cover).toContain("sm:aspect-square");
    expect(card.content).toContain("p-3");
    expect(card.content).toContain("sm:p-4");
    expect(card.description).toContain("max-sm:hidden");
    expect(card.tags).toContain("max-sm:hidden");
  });

  it("keeps the list row unchanged at every width", () => {
    const card = renderDensity("list");
    expect(card.cover).toContain("aspect-square");
    expect(card.cover).not.toContain("aspect-[4/3]");
    expect(card.content).toContain("p-4");
    expect(card.content).not.toContain("p-3");
    expect(card.description).not.toContain("max-sm:hidden");
    expect(card.tags).not.toContain("max-sm:hidden");
  });

  it("frames a contained cover on a muted backdrop instead of bare letterbox bands", () => {
    expect(renderDensity("grid", "contain").cover).toContain("bg-muted");
    expect(renderDensity("list", "contain").cover).toContain("bg-muted");
    expect(renderDensity("grid", "cover").cover).not.toContain("bg-muted");
  });
});

describe("PuzzleCardShell difficulty pill", () => {
  it.each(["easy", "medium", "hard", "expert"] as const)(
    "gives the %s difficulty pill dark-mode colours (UX-10)",
    (difficulty) => {
      const label = en.puzzles.puzzles.difficulty[difficulty];
      const host = document.createElement("div");
      host.innerHTML = renderToStaticMarkup(
        <IntlProvider locale="en" timeZone="UTC" messages={en}>
          <PuzzleViewProvider viewMode="grid">
            <PuzzleCardShell puzzle={puzzle({ difficulty })} />
          </PuzzleViewProvider>
        </IntlProvider>,
      );
      const pill = [...host.querySelectorAll('[data-slot="badge"]')].find(
        (el) => el.textContent === label,
      );
      expect(pill).toBeDefined();
      const cls = [...(pill?.classList ?? [])];
      expect(cls.some((c) => c.startsWith("dark:bg-"))).toBe(true);
      expect(cls.some((c) => c.startsWith("dark:text-"))).toBe(true);
    },
  );
});
