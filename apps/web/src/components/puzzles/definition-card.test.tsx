// @vitest-environment happy-dom
import type { ComponentProps, ReactNode } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { IntlProvider } from "use-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import en from "../../../locales/en.json";
import { DefinitionCard } from "./definition-card";
import { PuzzleViewProvider } from "./puzzle-view-provider";

// Router-free Link: the test asserts the cover's DOM, not routing.
vi.mock("@/compat/link", () => ({
  Link: ({ href, children }: { href: string; children?: ReactNode }) => (
    <a href={href}>{children}</a>
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

type Card = ComponentProps<typeof DefinitionCard>["card"];

const card = (extra: Partial<Card> = {}): Card => ({
  _id: "p1",
  title: "Harbour at dusk",
  pieceCount: 1000,
  image: "https://cdn.test/original",
  rating: { value: 0, count: 0 },
  availableToSwap: 0,
  ...extra,
});

const SIZES = "(min-width: 1024px) 25vw, 50vw";

// Inside the grid provider, as on the /catalog page.
const render = (c: Card) =>
  act(() =>
    root.render(
      <IntlProvider locale="en" timeZone="UTC" messages={en}>
        <PuzzleViewProvider viewMode="grid">
          <DefinitionCard card={c} imageSizes={SIZES} />
        </PuzzleViewProvider>
      </IntlProvider>,
    ),
  );

describe("DefinitionCard cover", () => {
  it("lets the browser pick a box-art rendition for the catalogue grid", () => {
    const srcSet =
      "https://cdn.test/480 480w, https://cdn.test/960 960w, https://cdn.test/original 1600w";
    render(card({ imageSrcSet: srcSet }));
    const img = container.querySelector("img");
    expect(img?.getAttribute("src")).toBe("https://cdn.test/original");
    expect(img?.getAttribute("srcset")).toBe(srcSet);
    expect(img?.getAttribute("sizes")).toBe(SIZES);
  });

  it("shows the original alone before renditions exist", () => {
    render(card());
    const img = container.querySelector("img");
    expect(img?.getAttribute("src")).toBe("https://cdn.test/original");
    expect(img?.hasAttribute("srcset")).toBe(false);
    expect(img?.hasAttribute("sizes")).toBe(false);
  });
});
