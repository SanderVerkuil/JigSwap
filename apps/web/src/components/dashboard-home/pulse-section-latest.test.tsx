import { gateway, type Id } from "@/gateway";
import { convexQuery, ConvexQueryClient } from "@convex-dev/react-query";
import type { ActivityEntryView } from "@jigswap/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ConvexReactClient } from "convex/react";
import { parseFragment, type DefaultTreeAdapterMap } from "parse5";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { IntlProvider } from "use-intl";
import { describe, expect, it, vi } from "vitest";
import en from "../../../locales/en.json";
import nl from "../../../locales/nl.json";
import { PulseSection } from "./pulse-section";

const ME = "me1" as Id<"users">;
const NOW = new Date("2026-10-30T12:00:00Z");

// Router-free Link: the test asserts the rendered text, not routing.
vi.mock("@tanstack/react-router", () => ({
  Link: ({ to, children, ...rest }: { to: string; children?: ReactNode }) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("./use-current-member", () => ({
  useCurrentMember: () => ({
    member: { _id: ME, name: "Sanne" },
    isMemberLoading: false,
  }),
}));

const entry = (over: Partial<ActivityEntryView>): ActivityEntryView => ({
  memberId: ME,
  kind: "acquisition",
  occurredAt: NOW.getTime() - 60_000,
  ref: crypto.randomUUID(),
  actorName: "Sanne",
  actor: { handle: ME },
  ...over,
});

const render = (feed: ActivityEntryView[], locale: "en" | "nl" = "en") => {
  // No network: SSR never runs effects, so queries only read the seeded cache.
  const convex = new ConvexReactClient("https://example.convex.cloud");
  const convexQueryClient = new ConvexQueryClient(convex);
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        queryKeyHashFn: convexQueryClient.hashFn(),
        queryFn: () => new Promise<never>(() => {}),
      },
    },
  });
  queryClient.setQueryData(
    convexQuery(gateway.exchange.myLive, {}).queryKey,
    [],
  );
  queryClient.setQueryData(
    convexQuery(gateway.exchange.myHistory, {
      paginationOpts: { numItems: 3, cursor: null },
    }).queryKey,
    { page: [], isDone: true, continueCursor: "" },
  );
  queryClient.setQueryData(
    convexQuery(gateway.solving.myGoals, {}).queryKey,
    [],
  );
  queryClient.setQueryData(
    convexQuery(gateway.social.activityFeed, { limit: 8 }).queryKey,
    feed,
  );
  return renderToStaticMarkup(
    <QueryClientProvider client={queryClient}>
      <IntlProvider
        locale={locale}
        messages={locale === "en" ? en : nl}
        timeZone="Europe/Amsterdam"
        now={NOW}
      >
        <PulseSection />
      </IntlProvider>
    </QueryClientProvider>,
  );
};

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
// The sentence of each Latest row (the text block next to the avatar).
const sentences = (html: string) =>
  elements(parseFragment(html))
    .filter((el) =>
      el.attrs.some(
        (a) => a.name === "class" && a.value.includes("leading-snug"),
      ),
    )
    .map((el) => text(el).replace(/\s+/g, " ").trim());

describe("PulseSection — section links", () => {
  // [href, accessible text, visible text] of the In Motion and Goals "All" links.
  const allLinks = (html: string) =>
    elements(parseFragment(html))
      .filter(
        (el) =>
          el.tagName === "a" &&
          el.attrs.some(
            (a) =>
              a.name === "href" &&
              (a.value === "/trades" || a.value === "/goals"),
          ) &&
          /^Alle?\b/.test(text(el)),
      )
      .map((a) => [
        a.attrs.find((x) => x.name === "href")?.value,
        text(a),
        text({
          childNodes: a.childNodes.filter(
            (child) =>
              !("attrs" in child) ||
              !child.attrs.some(
                (x) => x.name === "class" && x.value === "sr-only",
              ),
          ),
        }),
      ]);

  it("names each All link after what it lists", () => {
    expect(allLinks(render([]))).toEqual([
      ["/trades", "All exchanges", "All"],
      ["/goals", "All goals", "All"],
    ]);
  });

  it("in Dutch, too", () => {
    expect(allLinks(render([], "nl"))).toEqual([
      ["/trades", "Alle uitwisselingen", "Alle"],
      ["/goals", "Alle doelen", "Alle"],
    ]);
  });
});

describe("PulseSection — Latest rows", () => {
  it("names the puzzle when the feed sends its title", () => {
    const rows = sentences(
      render([
        entry({ kind: "acquisition", title: "Mountain Vista" }),
        entry({ kind: "completion", title: "Harbour Lights" }),
        entry({ kind: "started", title: "Tulip Fields" }),
      ]),
    );
    expect(rows[0]).toContain("Sanne added Mountain Vista to their shelf");
    expect(rows[1]).toContain("Sanne finished Harbour Lights");
    expect(rows[2]).toContain("Sanne started Tulip Fields");
  });

  it("keeps the generic sentence without a title", () => {
    const rows = sentences(
      render([entry({ kind: "acquisition" }), entry({ kind: "completion" })]),
    );
    expect(rows[0]).toContain("Sanne added a puzzle to their shelf");
    expect(rows[1]).toContain("Sanne finished a puzzle");
  });

  it("reads naturally in Dutch", () => {
    const rows = sentences(
      render(
        [
          entry({ kind: "acquisition", title: "Mountain Vista" }),
          entry({ kind: "completion", title: "Harbour Lights" }),
          entry({ kind: "started", title: "Tulip Fields" }),
        ],
        "nl",
      ),
    );
    expect(rows[0]).toContain("Sanne heeft Mountain Vista op de plank gezet");
    expect(rows[1]).toContain("Sanne heeft Harbour Lights afgemaakt");
    expect(rows[2]).toContain("Sanne is aan Tulip Fields begonnen");
  });
});
