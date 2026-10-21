import { GUIDE_AREAS, TOURS } from "@/components/tour/definitions";
import type { WhatsNewEntry } from "@/whats-new/types";
import type { WhatsNewTourProgressView } from "@jigswap/contracts";
import { parseFragment, type DefaultTreeAdapterMap } from "parse5";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { IntlProvider } from "use-intl";
import { describe, expect, it, vi } from "vitest";
import en from "../../../locales/en.json";
import { GuidesList } from "./guides-list";

// Router-free Link: the test asserts the list's DOM, not routing.
vi.mock("@tanstack/react-router", () => ({
  Link: ({
    to,
    hash,
    children,
    ...rest
  }: {
    to: string;
    hash?: string;
    search?: unknown;
    children?: ReactNode;
  }) => {
    delete (rest as { search?: unknown }).search;
    return (
      <a href={hash ? `${to}#${hash}` : to} {...rest}>
        {children}
      </a>
    );
  },
}));

const households: WhatsNewEntry = {
  id: "households-entry",
  publishedAt: Date.parse("2026-10-17T08:00:00Z"),
  category: "feature",
  highlight: false,
  notify: false,
  tour: "households",
  content: {
    en: { title: "Households", summary: "s", html: "", fallback: false },
    nl: { title: "Huishoudens", summary: "s", html: "", fallback: false },
  },
};

const render = (tours?: WhatsNewTourProgressView[]) =>
  renderToStaticMarkup(
    <IntlProvider locale="en" messages={en} timeZone="Europe/Amsterdam">
      <GuidesList entries={[households]} tours={tours} />
    </IntlProvider>,
  );

type Node = DefaultTreeAdapterMap["childNode"];
type Element = DefaultTreeAdapterMap["element"];
const isElement = (node: Node): node is Element => "tagName" in node;
const elementsOf = (root: { childNodes: Node[] }): Element[] => {
  const out: Element[] = [];
  const walk = (nodes: Node[]) => {
    for (const node of nodes) {
      if (!isElement(node)) continue;
      out.push(node);
      walk(node.childNodes);
    }
  };
  walk(root.childNodes);
  return out;
};
const parse = (html: string) => elementsOf(parseFragment(html));
const attr = (el: Element, name: string) =>
  el.attrs.find((a) => a.name === name)?.value;
const textOf = (el: Element): string =>
  el.childNodes
    .map((child) =>
      isElement(child) ? textOf(child) : "value" in child ? child.value : "",
    )
    .join("");
const guide = (els: Element[], tourId: string) => {
  const found = els.find(
    (el) => el.tagName === "article" && attr(el, "id") === `guide-${tourId}`,
  );
  if (!found) throw new Error(`no guide card for ${tourId}`);
  return found;
};

describe("GuidesList", () => {
  it("lists every tour once, grouped under its area's heading", () => {
    const els = parse(render());
    const cards = els.filter((el) => el.tagName === "article");
    expect(cards.map((el) => attr(el, "id"))).toHaveLength(TOURS.size);
    for (const tour of TOURS.values()) {
      const section = els.find(
        (el) =>
          el.tagName === "section" &&
          attr(el, "aria-labelledby") === `guides-${tour.guide.area}`,
      );
      expect(section, tour.id).toBeDefined();
      expect(
        elementsOf(section!).some(
          (el) => attr(el, "id") === `guide-${tour.id}`,
        ),
      ).toBe(true);
    }
    const headings = els
      .filter((el) => el.tagName === "h2")
      .map((el) => attr(el, "id"));
    // In GUIDE_AREAS order.
    expect(headings).toEqual(
      GUIDE_AREAS.filter((area) =>
        [...TOURS.values()].some((tour) => tour.guide.area === area),
      ).map((area) => `guides-${area}`),
    );
  });

  it("counts finished guides and shows each guide's state", () => {
    const els = parse(
      render([
        { tourId: "households", status: "completed", updatedAt: 1 },
        {
          tourId: "member-profiles",
          status: "in_progress",
          step: 1,
          updatedAt: 1,
        },
      ]),
    );
    expect(textOf(els.find((el) => el.tagName === "p")!)).toBe(
      `1 of ${TOURS.size} guides done`,
    );

    const done = guide(els, "households");
    expect(textOf(done)).toContain("Done");
    expect(textOf(done)).toContain("Replay the tour");

    const paused = guide(els, "member-profiles");
    expect(textOf(paused)).toContain("Step 2 of 2");
    expect(textOf(paused)).toContain("Start over");

    const fresh = guide(els, "getting-started");
    expect(textOf(fresh)).not.toContain("Done");
    expect(textOf(fresh)).not.toMatch(/Step \d/);
    expect(textOf(fresh)).toContain("Take the tour");
    expect(textOf(fresh)).toContain("4 steps");
  });

  it("links a guide back to the update that introduced it", () => {
    const els = parse(render());
    const link = elementsOf(guide(els, "households")).find(
      (el) => el.tagName === "a",
    );
    expect(attr(link!, "href")).toBe("/whats-new#entry-households-entry");
    expect(textOf(link!)).toBe("Introduced October 2026");
    expect(
      elementsOf(guide(els, "getting-started")).some(
        (el) => el.tagName === "a",
      ),
    ).toBe(false);
  });
});
