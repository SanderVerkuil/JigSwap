import { gateway } from "@/gateway";
import { convexQuery, ConvexQueryClient } from "@convex-dev/react-query";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ConvexProviderWithAuth, ConvexReactClient } from "convex/react";
import { parseFragment, type DefaultTreeAdapterMap } from "parse5";
import { renderToStaticMarkup } from "react-dom/server";
import { IntlProvider } from "use-intl";
import { describe, expect, it } from "vitest";
import en from "../../../locales/en.json";
import { categoryOptions } from "./category-options";
import { PuzzleFilters } from "./puzzle-filters";

const useSignedOut = () => ({
  isLoading: false,
  isAuthenticated: false,
  fetchAccessToken: async () => null,
});

const category = (id: string, en: string, nl: string) => ({
  _id: id,
  _creationTime: 1,
  name: { en, nl },
  isActive: true,
  sortOrder: 1,
  createdAt: 1,
  updatedAt: 1,
});

const emptyFilters = {
  searchTerm: "",
  brand: "",
  minPieces: "",
  maxPieces: "",
  difficulty: "",
  category: "",
  tags: [],
};

// Seeds only the public reads: if the panel still asked for the admin-only listAll, it would
// stay on its loading state.
const render = () => {
  const convex = new ConvexReactClient("https://example.convex.cloud");
  const convexQueryClient = new ConvexQueryClient(convex);
  const queryClient = new QueryClient({
    defaultOptions: { queries: { queryKeyHashFn: convexQueryClient.hashFn() } },
  });
  queryClient.setQueryData(
    convexQuery(gateway.catalog.allBrands, {}).queryKey,
    [],
  );
  queryClient.setQueryData(
    convexQuery(gateway.catalog.allTags, {}).queryKey,
    [],
  );
  queryClient.setQueryData(
    convexQuery(gateway.catalog.puzzleCategories, {}).queryKey,
    [category("cat_1", "Animals", "Dieren")],
  );
  return renderToStaticMarkup(
    <ConvexProviderWithAuth client={convex} useAuth={useSignedOut}>
      <QueryClientProvider client={queryClient}>
        <IntlProvider locale="en" messages={en} timeZone="Europe/Amsterdam">
          <PuzzleFilters filters={emptyFilters} onFiltersChange={() => {}} />
        </IntlProvider>
      </QueryClientProvider>
    </ConvexProviderWithAuth>,
  );
};

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

describe("PuzzleFilters", () => {
  it("renders the category filter from the public taxonomy read", () => {
    const els = elementsOf(render());
    expect(els.some((e) => attr(e, "id") === "category-filter")).toBe(true);
  });
});

describe("categoryOptions", () => {
  const categories = [
    category("cat_2", "Maps", "Landkaarten"),
    category("cat_1", "Animals", "Dieren"),
  ];

  it("keys each option by the adminCategories _id a puzzle's category holds, keeping order", () => {
    expect(categoryOptions(categories, "en")).toEqual([
      { value: "cat_2", label: "Maps" },
      { value: "cat_1", label: "Animals" },
    ]);
  });

  it("labels options in the UI locale, falling back to English when blank", () => {
    expect(
      categoryOptions(
        [...categories, category("cat_3", "Transport", "  ")],
        "nl",
      ).map((option) => option.label),
    ).toEqual(["Landkaarten", "Dieren", "Transport"]);
  });
});
