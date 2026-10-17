import { gateway } from "@/gateway";
import { convexQuery, ConvexQueryClient } from "@convex-dev/react-query";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ConvexReactClient } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { parseFragment, type DefaultTreeAdapterMap } from "parse5";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { IntlProvider } from "use-intl";
import { describe, expect, it, vi } from "vitest";
import en from "../../../locales/en.json";
import nl from "../../../locales/nl.json";
import { ActivityFeed } from "./activity-feed";

// Router-free Link: the test asserts the rendered href (path params + hash), not routing.
vi.mock("@tanstack/react-router", () => ({
  Link: ({
    to,
    params,
    hash,
    children,
    ...rest
  }: {
    to: string;
    params?: Record<string, string>;
    hash?: string;
    children?: ReactNode;
  }) => (
    <a
      href={
        Object.entries(params ?? {}).reduce(
          (path, [key, value]) => path.replace(`$${key}`, value),
          to,
        ) + (hash ? `#${hash}` : "")
      }
      {...rest}
    >
      {children}
    </a>
  ),
}));

type Feed = FunctionReturnType<typeof gateway.social.activityFeed>;

const ME = "me1";
const SANDER = "sander1";

const cover = (i: number, coverUrl: string | null = null) => ({
  copyId: `copy-${i}`,
  title: `Puzzle ${i}`,
  coverUrl,
});

const batchEntry = (
  memberId: string,
  count: number,
  covers = [
    cover(0, "https://example.com/0.jpg"),
    cover(1),
    cover(2),
    cover(3),
  ],
): Feed[number] => ({
  memberId,
  kind: "acquisitionBatch",
  occurredAt: Date.now() - 60_000,
  ref: `batch-${memberId}`,
  actorName: memberId === SANDER ? "Sander" : "Me",
  batch: { count, covers: covers.slice(0, count) },
  actor: { handle: memberId },
  target: { kind: "memberPuzzles", handle: memberId },
});

const render = (feed: Feed, locale: "en" | "nl" = "en") => {
  // No network: SSR never runs effects, so queries only read the seeded cache.
  const convex = new ConvexReactClient("https://example.convex.cloud");
  const convexQueryClient = new ConvexQueryClient(convex);
  const queryClient = new QueryClient({
    defaultOptions: { queries: { queryKeyHashFn: convexQueryClient.hashFn() } },
  });
  queryClient.setQueryData(
    convexQuery(gateway.social.activityFeed, {}).queryKey,
    feed,
  );
  queryClient.setQueryData(
    convexQuery(gateway.identity.currentUser, {}).queryKey,
    { _id: ME, name: "Me" },
  );
  return renderToStaticMarkup(
    <QueryClientProvider client={queryClient}>
      <IntlProvider
        locale={locale}
        messages={locale === "en" ? en : nl}
        timeZone="Europe/Amsterdam"
        now={new Date()}
      >
        <ActivityFeed />
      </IntlProvider>
    </QueryClientProvider>,
  );
};

// Assert on a real HTML tree (parse5), never on regex-extracted markup.
type Node = DefaultTreeAdapterMap["childNode"];
type Element = DefaultTreeAdapterMap["element"];

const isElement = (node: Node): node is Element => "tagName" in node;

const elementsOf = (html: string): Element[] => {
  const out: Element[] = [];
  const walk = (nodes: Node[]) => {
    for (const node of nodes) {
      if (!isElement(node)) continue;
      out.push(node);
      walk(node.childNodes);
    }
  };
  walk(parseFragment(html).childNodes);
  return out;
};

const attr = (el: Element, name: string) =>
  el.attrs.find((a) => a.name === name)?.value;

const textOf = (el: Element): string =>
  el.childNodes
    .map((child) =>
      isElement(child) ? textOf(child) : "value" in child ? child.value : "",
    )
    .join("");

const descendantsOf = (el: Element): Element[] =>
  el.childNodes.filter(isElement).flatMap((c) => [c, ...descendantsOf(c)]);

const links = (els: Element[]) => els.filter((el) => el.tagName === "a");

const profilePuzzlesLink = (els: Element[]) =>
  links(els).find((el) => attr(el, "href")?.endsWith("#puzzles"));

const sentences = (html: string) =>
  elementsOf(html)
    .filter((el) => el.tagName === "p")
    .map(textOf);

describe("ActivityFeed — grouped batch adds", () => {
  it("renders one sentence with the plural count (en)", () => {
    const html = render([batchEntry(SANDER, 10)]);
    expect(sentences(html)).toContain("Sander added 10 puzzles to their shelf");
  });

  it("uses the singular for a batch of one (en)", () => {
    const html = render([batchEntry(SANDER, 1)]);
    expect(sentences(html)).toContain("Sander added 1 puzzle to their shelf");
  });

  it("renders the viewer's own batch in the second person (en)", () => {
    const html = render([batchEntry(ME, 3)]);
    expect(sentences(html)).toContain("You added 3 puzzles to your shelf");
  });

  it("renders the plural and singular in Dutch", () => {
    expect(sentences(render([batchEntry(SANDER, 10)], "nl"))).toContain(
      "Sander heeft 10 puzzels op de plank gezet",
    );
    expect(sentences(render([batchEntry(SANDER, 1)], "nl"))).toContain(
      "Sander heeft 1 puzzel op de plank gezet",
    );
    expect(sentences(render([batchEntry(ME, 2)], "nl"))).toContain(
      "Je hebt 2 puzzels op je plank gezet",
    );
  });

  it("links the row to the member's profile puzzles and shows the covers with the rest as +N", () => {
    const html = render([batchEntry(SANDER, 10)]);
    const els = elementsOf(html);
    const link = els.find(
      (el) =>
        el.tagName === "a" && attr(el, "href") === "/members/sander1#puzzles",
    );
    expect(link).toBeDefined();
    expect(attr(link!, "aria-label")).toBe(
      "View these 10 puzzles on the profile",
    );
    const strip = els.find((el) => attr(el, "data-slot") === "batch-covers")!;
    const stripEls = descendantsOf(strip);
    // One real image (the cover that has a URL) plus three placeholder chips.
    const images = stripEls.filter((el) => el.tagName === "img");
    expect(images.map((img) => attr(img, "src"))).toEqual([
      "https://example.com/0.jpg",
    ]);
    expect(attr(images[0]!, "title")).toBe("Puzzle 0");
    expect(
      stripEls.filter((el) => attr(el, "data-slot") === "batch-cover"),
    ).toHaveLength(4);
    expect(textOf(strip)).toContain("+6");
    // The covers are not a link of their own: the row's target link spans them.
    expect(stripEls.some((el) => el.tagName === "a")).toBe(false);
  });

  it("shows no +N when every visible copy has a cover", () => {
    const html = render([batchEntry(SANDER, 2)]);
    const els = elementsOf(html);
    const strip = els.find((el) => attr(el, "data-slot") === "batch-covers")!;
    expect(textOf(strip)).not.toContain("+");
    expect(attr(profilePuzzlesLink(els)!, "aria-label")).toBe(
      "View these 2 puzzles on the profile",
    );
  });

  it("labels a one-copy batch in the singular (nl)", () => {
    const html = render([batchEntry(SANDER, 1)], "nl");
    expect(attr(profilePuzzlesLink(elementsOf(html))!, "aria-label")).toBe(
      "Bekijk deze puzzel op het profiel",
    );
  });

  it("leaves single adds as their own sentence without covers", () => {
    const html = render([
      {
        memberId: SANDER,
        kind: "acquisition",
        occurredAt: Date.now() - 60_000,
        ref: "copy-x",
        actorName: "Sander",
      },
    ]);
    expect(sentences(html)).toContain("Sander added a puzzle to their shelf");
    expect(elementsOf(html).some((el) => el.tagName === "a")).toBe(false);
  });
});

describe("ActivityFeed — links", () => {
  const entry = (overrides: Partial<Feed[number]>): Feed[number] => ({
    memberId: SANDER,
    kind: "acquisition",
    occurredAt: Date.now() - 60_000,
    ref: "copy-x",
    actorName: "Sander",
    ...overrides,
  });

  it.each([
    [{ kind: "copy", id: "c1" }, "/copies/c1", "View the puzzle"],
    [{ kind: "myCopy", id: "c2" }, "/my-puzzles/c2", "View the puzzle"],
    [{ kind: "definition", id: "p1" }, "/puzzles/p1", "View the puzzle"],
    [{ kind: "trades" }, "/trades", "View your exchanges"],
  ] as const)("maps a %o target to its route", (target, href, label) => {
    const els = elementsOf(render([entry({ target })]));
    const [link] = links(els);
    expect(links(els)).toHaveLength(1);
    expect(attr(link!, "href")).toBe(href);
    expect(attr(link!, "aria-label")).toBe(label);
  });

  it("translates the target label (nl)", () => {
    const els = elementsOf(
      render([entry({ target: { kind: "trades" } })], "nl"),
    );
    expect(attr(links(els)[0]!, "aria-label")).toBe("Bekijk je uitwisselingen");
  });

  it("links the actor's name to their profile, as a sibling of the row link", () => {
    const els = elementsOf(
      render([
        entry({
          actor: { handle: SANDER },
          target: { kind: "copy", id: "c1" },
        }),
      ]),
    );
    const actorLink = links(els).find(
      (el) => attr(el, "href") === "/members/sander1",
    );
    expect(actorLink).toBeDefined();
    expect(textOf(actorLink!)).toBe("Sander");
    expect(links(els)).toHaveLength(2);
    // No interactive element nested inside another link.
    for (const link of links(els)) {
      expect(descendantsOf(link).some((el) => el.tagName === "a")).toBe(false);
    }
  });

  it("renders plain text without an actor or target", () => {
    const html = render([entry({})]);
    expect(sentences(html)).toContain("Sander added a puzzle to their shelf");
    expect(links(elementsOf(html))).toHaveLength(0);
  });

  it("skips a target kind this bundle does not know", () => {
    const unknown = { kind: "future" } as unknown as Feed[number]["target"];
    expect(links(elementsOf(render([entry({ target: unknown })])))).toEqual([]);
  });
});
