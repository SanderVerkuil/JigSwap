// @vitest-environment happy-dom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { IntlProvider } from "use-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import en from "../../../locales/en.json";
import nl from "../../../locales/nl.json";
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

  it("sizes the list view's cover to its fixed thumbnail", () => {
    render(puzzle({ imageSrcSet: SRC_SET }), "list", GRID_SIZES);
    expect(cover().getAttribute("srcset")).toBe(SRC_SET);
    expect(cover().getAttribute("sizes")).toBe("56px");
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
  Link: ({
    children,
    href,
    ...rest
  }: {
    children?: ReactNode;
    href: string;
  }) => (
    <a href={href} {...rest}>
      {children}
    </a>
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
    );
  return {
    cover: host.querySelector("img")!.parentElement!.classList,
    thumbnail:
      host.querySelector("img")!.parentElement!.parentElement!.classList,
    // The content column is the card's second child in grid mode.
    content: byText("Sheep everywhere")?.parentElement?.classList,
    description: byText("Sheep everywhere")?.classList,
    tags: byText("#cartoon")?.parentElement?.classList,
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

  it("is one compact line in list mode: a small thumbnail, no description or tags", () => {
    const card = renderDensity("list");
    expect(card.cover).toContain("aspect-square");
    expect(card.cover).not.toContain("aspect-[4/3]");
    expect(card.thumbnail).toContain("size-14");
    expect(card.thumbnail).toContain("sm:size-12");
    expect(card.description).toBeUndefined();
    expect(card.tags).toBeUndefined();
  });

  it("frames a contained cover on a muted backdrop instead of bare letterbox bands", () => {
    expect(renderDensity("grid", "contain").cover).toContain("bg-muted");
    expect(renderDensity("list", "contain").cover).toContain("bg-muted");
    expect(renderDensity("grid", "cover").cover).not.toContain("bg-muted");
  });
});

describe("PuzzleCardShell piece count", () => {
  // The count follows the app locale, never the server's or browser's (UX-63), and the
  // word agrees with it: Dutch says "stukje"/"stukjes", never "stukken" (UX-65).
  it.each([
    ["en", 1000, "1,000 pieces"],
    ["nl", 1000, "1.000 stukjes"],
    ["en", 1, "1 piece"],
    ["nl", 1, "1 stukje"],
  ] as const)(
    "labels the %s piece count %s as %s",
    (locale, pieceCount, expected) => {
      const html = renderToStaticMarkup(
        <IntlProvider
          locale={locale}
          timeZone="UTC"
          messages={locale === "nl" ? nl : en}
        >
          <PuzzleViewProvider viewMode="grid">
            <PuzzleCardShell puzzle={puzzle({ pieceCount })} />
          </PuzzleViewProvider>
        </IntlProvider>,
      );
      expect(html).toContain(`>${expected}<`);
    },
  );
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

  // A grid directly under the page h1 asks for h2 titles; nested grids keep h3 (UX-66).
  it.each([
    [undefined, "h3"],
    [3, "h3"],
    [2, "h2"],
  ] as const)("titles the card at headingLevel %s as %s", (level, tag) => {
    const host = document.createElement("div");
    host.innerHTML = renderToStaticMarkup(
      <IntlProvider locale="en" timeZone="UTC" messages={en}>
        <PuzzleViewProvider viewMode="grid">
          <PuzzleCardShell
            puzzle={puzzle()}
            imageHref="/puzzles/p1"
            headingLevel={level}
          />
        </PuzzleViewProvider>
      </IntlProvider>,
    );
    const headings = [...host.querySelectorAll("h1, h2, h3, h4, h5, h6")];
    expect(headings.map((h) => h.tagName.toLowerCase())).toEqual([tag]);
  });

  it("rings the whole card when its stretched title link has keyboard focus (UX-72)", () => {
    const host = document.createElement("div");
    host.innerHTML = renderToStaticMarkup(
      <IntlProvider locale="en" timeZone="UTC" messages={en}>
        <PuzzleViewProvider viewMode="grid">
          <PuzzleCardShell puzzle={puzzle()} imageHref="/puzzles/p1" />
        </PuzzleViewProvider>
      </IntlProvider>,
    );
    const link = host.querySelector("a");
    expect(link?.getAttribute("href")).toBe("/puzzles/p1");
    // The link hides its own outline (it would only circle the title)...
    expect(link?.getAttribute("data-card-link")).toBe("");
    expect(link?.classList.contains("focus-visible:outline-none")).toBe(true);
    // ...so the card draws a full-alpha ring while the link is focused.
    const card = host.querySelector('[data-slot="card"]');
    expect([...(card?.classList ?? [])]).toEqual(
      expect.arrayContaining([
        "has-[[data-card-link]:focus-visible]:ring-2",
        "has-[[data-card-link]:focus-visible]:ring-ring",
      ]),
    );
  });
});
