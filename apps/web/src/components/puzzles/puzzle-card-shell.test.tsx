// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { IntlProvider } from "use-intl";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
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
