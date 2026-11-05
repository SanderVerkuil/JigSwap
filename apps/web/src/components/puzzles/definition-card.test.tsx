// @vitest-environment happy-dom
import type { ComponentProps, ReactNode } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
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
const SRC_SET =
  "https://cdn.test/480 480w, https://cdn.test/960 960w, https://cdn.test/original 1600w";

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
    render(card({ imageSrcSet: SRC_SET }));
    const img = container.querySelector("img");
    expect(img?.getAttribute("src")).toBe("https://cdn.test/original");
    expect(img?.getAttribute("srcset")).toBe(SRC_SET);
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

// The /catalog grid is server-rendered: what the HTML says decides whether the
// browser's preload scanner fetches the cover before the scripts run.
const ssrCover = (c: Card, priority?: boolean) => {
  const html = renderToStaticMarkup(
    <IntlProvider locale="en" messages={en} timeZone="Europe/Amsterdam">
      <PuzzleViewProvider viewMode="grid">
        <DefinitionCard card={c} imageSizes={SIZES} priority={priority} />
      </PuzzleViewProvider>
    </IntlProvider>,
  );
  return html.match(/<img[^>]*>/)?.[0] ?? "";
};

describe("DefinitionCard cover priority", () => {
  it("loads lazily by default (cards below the fold)", () => {
    const img = ssrCover(card());
    expect(img).toContain('loading="lazy"');
    expect(img).not.toMatch(/fetchpriority/i);
  });

  it("loads eagerly at high priority for a first-row card", () => {
    const img = ssrCover(card(), true);
    expect(img).toContain('loading="eager"');
    // HTML attribute names are case-insensitive; React writes fetchPriority.
    expect(img).toMatch(/fetchpriority="high"/i);
  });

  it("keeps the rendition choice on a first-row card: srcset decides what, priority when", () => {
    const img = ssrCover(card({ imageSrcSet: SRC_SET }), true);
    expect(img).toMatch(/srcset="[^"]*480w/i);
    expect(img).toContain(`sizes="${SIZES}"`);
    expect(img).toMatch(/fetchpriority="high"/i);
  });
});
