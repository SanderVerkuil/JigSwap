import { gateway } from "@/gateway";
import { ConvexQueryClient, convexQuery } from "@convex-dev/react-query";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ConvexProviderWithAuth, ConvexReactClient } from "convex/react";
import { parseFragment, type DefaultTreeAdapterMap } from "parse5";
import { renderToStaticMarkup } from "react-dom/server";
import { IntlProvider } from "use-intl";
import { describe, expect, it } from "vitest";
import en from "../../../locales/en.json";
import nl from "../../../locales/nl.json";
import { MyHouseholdCopies } from "./my-household-copies";

const useSignedOut = () => ({
  isLoading: false,
  isAuthenticated: false,
  fetchAccessToken: async () => null,
});

const copy = (
  id: string,
  title: string,
  householdPermission: "manage" | "view",
  coverUrl?: string,
  permissionSource: "explicit" | "default" = "explicit",
) => ({
  _id: id,
  puzzleId: "p",
  ownerId: "me",
  condition: "good",
  availability: { forTrade: false, forSale: false, forLend: false },
  createdAt: 1,
  updatedAt: 1,
  puzzle: null,
  snapshot: { title, pieceCount: 1000 },
  coverUrl,
  householdPermission,
  permissionSource,
});

const render = (copies: unknown[], locale: "en" | "nl" = "en") => {
  // No network: SSR never runs effects, so the query only reads the seeded cache.
  const convex = new ConvexReactClient("https://example.convex.cloud");
  const convexQueryClient = new ConvexQueryClient(convex);
  const queryClient = new QueryClient({
    defaultOptions: { queries: { queryKeyHashFn: convexQueryClient.hashFn() } },
  });
  queryClient.setQueryData(
    convexQuery(gateway.household.myCopyPermissions, {}).queryKey,
    copies,
  );
  return renderToStaticMarkup(
    <ConvexProviderWithAuth client={convex} useAuth={useSignedOut}>
      <QueryClientProvider client={queryClient}>
        <IntlProvider
          locale={locale}
          messages={locale === "en" ? en : nl}
          timeZone="Europe/Amsterdam"
        >
          <MyHouseholdCopies householdDefault="view" onError={() => {}} />
        </IntlProvider>
      </QueryClientProvider>
    </ConvexProviderWithAuth>,
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
    .map((n) =>
      "value" in n && n.nodeName === "#text"
        ? n.value
        : isElement(n)
          ? textOf(n)
          : "",
    )
    .join("");

describe("MyHouseholdCopies", () => {
  it("lists each own copy with a labelled checkbox, thumbnail and current permission", () => {
    const els = elementsOf(
      render([
        copy("a", "Harbour", "manage", "https://img/a.jpg"),
        copy("b", "Forest", "view", undefined, "default"),
      ]),
    );
    expect(textOf(els.find((e) => e.tagName === "h2")!)).toBe(
      "My puzzles in this household",
    );
    const rows = els.filter((e) => e.tagName === "li");
    expect(rows.map(textOf)).toEqual([
      "HarbourSet for this puzzleCan manage",
      "ForestHousehold defaultView only",
    ]);
    const boxes = els.filter((e) => attr(e, "role") === "checkbox");
    expect(boxes.map((b) => attr(b, "aria-label"))).toEqual([
      "Select Harbour",
      "Select Forest",
    ]);
    expect(boxes.every((b) => attr(b, "aria-checked") === "false")).toBe(true);
    expect(
      els.filter((e) => e.tagName === "img").map((i) => attr(i, "src")),
    ).toEqual(["https://img/a.jpg"]);
  });

  it("disables both bulk actions while nothing is selected", () => {
    const els = elementsOf(render([copy("a", "Harbour", "manage")]));
    const action = (label: string) =>
      els.find((e) => e.tagName === "button" && textOf(e) === label)!;
    expect(attr(action("Set to Can manage"), "disabled")).toBeDefined();
    expect(attr(action("Set to View only"), "disabled")).toBeDefined();
    expect(
      attr(action("Use household default (currently: View only)"), "disabled"),
    ).toBeDefined();
    expect(attr(action("Select all"), "disabled")).toBeUndefined();
  });

  it("shows the empty state in Dutch when the member has no puzzles", () => {
    const els = elementsOf(render([], "nl"));
    expect(els.filter((e) => e.tagName === "li")).toEqual([]);
    expect(els.map(textOf)).toContain("Je hebt nog geen puzzels toegevoegd.");
  });
});
