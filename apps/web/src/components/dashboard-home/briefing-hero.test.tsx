import { parseFragment, type DefaultTreeAdapterMap } from "parse5";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { IntlProvider } from "use-intl";
import { describe, expect, it, vi } from "vitest";
import en from "../../../locales/en.json";
import nl from "../../../locales/nl.json";
import { Headline, headlineVariant } from "./briefing-hero";

// Router-free Link: the test asserts the rendered href, not routing.
vi.mock("@tanstack/react-router", () => ({
  Link: ({ to, children, ...rest }: { to: string; children?: ReactNode }) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
}));

const quiet = {
  activeCount: 0,
  pendingCount: 0,
  hasGoal: false,
  ownedCount: 0,
  offeredCount: 0,
};

describe("headlineVariant", () => {
  it("leads with swaps, requests and goals whatever the shelf holds", () => {
    const shelf = { ownedCount: 3, offeredCount: 3 };
    expect(
      headlineVariant({ ...quiet, ...shelf, activeCount: 1, pendingCount: 1 }),
    ).toBe("swapsPending");
    expect(headlineVariant({ ...quiet, ...shelf, pendingCount: 2 })).toBe(
      "pendingOnly",
    );
    expect(headlineVariant({ ...quiet, ...shelf, hasGoal: true })).toBe(
      "goalOnly",
    );
    expect(
      headlineVariant({
        ...quiet,
        ...shelf,
        activeCount: 1,
        pendingCount: 1,
        hasGoal: true,
      }),
    ).toBe("swapsPendingGoal");
  });

  it("talks about the shelf when nothing else is going on", () => {
    expect(headlineVariant({ ...quiet, ownedCount: 3, offeredCount: 0 })).toBe(
      "shelfOnly",
    );
    expect(headlineVariant({ ...quiet, ownedCount: 3, offeredCount: 2 })).toBe(
      "shelfOffered",
    );
  });

  it("invites a first puzzle only when the shelf is empty", () => {
    expect(headlineVariant(quiet)).toBe("empty");
  });
});

type Element = DefaultTreeAdapterMap["element"];
type Node = DefaultTreeAdapterMap["childNode"];
const elements = (root: { childNodes: Node[] }): Element[] =>
  root.childNodes.flatMap((node) =>
    "tagName" in node ? [node, ...elements(node)] : [],
  );
const text = (node: { childNodes?: Node[] }): string =>
  (node.childNodes ?? [])
    .map((child) =>
      child.nodeName === "#text"
        ? (child as DefaultTreeAdapterMap["textNode"]).value
        : text(child as Element),
    )
    .join("");
const attr = (el: Element, name: string) =>
  el.attrs.find((a) => a.name === name)?.value;

const render = (
  props: Parameters<typeof Headline>[0],
  locale: "en" | "nl" = "en",
) => {
  const html = renderToStaticMarkup(
    <IntlProvider
      locale={locale}
      messages={locale === "en" ? en : nl}
      timeZone="Europe/Amsterdam"
    >
      <Headline {...props} />
    </IntlProvider>,
  );
  const root = parseFragment(html);
  const links = elements(root)
    .filter((el) => el.tagName === "a")
    .map((el) => [attr(el, "href"), text(el)]);
  return { text: text(root), links };
};

const noSwaps = { activeCount: 0, pendingCount: 0, goal: null };

describe("Headline — the shelf variants", () => {
  it("nudges a member whose puzzles are not offered to offer a few", () => {
    const { text, links } = render({
      ...noSwaps,
      ownedCount: 3,
      offeredCount: 0,
    });
    expect(text).toContain("3 puzzles on your shelf");
    expect(text).toContain("offer a few for swap");
    expect(links).toEqual([["/my-puzzles", "3 puzzles on your shelf"]]);
  });

  it("sends a member with puzzles up for swap to browse", () => {
    const { text, links } = render({
      ...noSwaps,
      ownedCount: 3,
      offeredCount: 1,
    });
    expect(text).toContain("1 puzzle up for swap");
    expect(links).toEqual([
      ["/my-puzzles", "1 puzzle up for swap"],
      ["/browse", "browse what others have"],
    ]);
  });

  it("reads naturally in Dutch", () => {
    expect(
      render({ ...noSwaps, ownedCount: 1, offeredCount: 0 }, "nl").text,
    ).toContain("1 puzzel op je plank");
    const offered = render(
      { ...noSwaps, ownedCount: 4, offeredCount: 3 },
      "nl",
    );
    expect(offered.text).toContain("3 puzzels te ruil");
    expect(offered.links.map(([href]) => href)).toEqual([
      "/my-puzzles",
      "/browse",
    ]);
  });

  it("keeps the first-puzzle invitation for an empty shelf", () => {
    expect(render({ ...noSwaps, ownedCount: 0, offeredCount: 0 }).text).toBe(
      en.dashboard.brief.empty,
    );
  });
});
