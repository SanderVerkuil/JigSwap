import { ConvexQueryClient } from "@convex-dev/react-query";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ConvexProviderWithAuth, ConvexReactClient } from "convex/react";
import { parseFragment, type DefaultTreeAdapterMap } from "parse5";
import { renderToStaticMarkup } from "react-dom/server";
import { IntlProvider } from "use-intl";
import { describe, expect, it } from "vitest";
import en from "../../../locales/en.json";
import nl from "../../../locales/nl.json";
import { HouseholdSettings } from "./household-settings";

const useSignedOut = () => ({
  isLoading: false,
  isAuthenticated: false,
  fetchAccessToken: async () => null,
});

const render = (
  props: {
    isAdmin: boolean;
    defaultCopyPermission: "manage" | "view";
    copiesUsingDefault: number;
  },
  locale: "en" | "nl" = "en",
) => {
  const convex = new ConvexReactClient("https://example.convex.cloud");
  const convexQueryClient = new ConvexQueryClient(convex);
  const queryClient = new QueryClient({
    defaultOptions: { queries: { queryKeyHashFn: convexQueryClient.hashFn() } },
  });
  return renderToStaticMarkup(
    <ConvexProviderWithAuth client={convex} useAuth={useSignedOut}>
      <QueryClientProvider client={queryClient}>
        <IntlProvider
          locale={locale}
          messages={locale === "en" ? en : nl}
          timeZone="Europe/Amsterdam"
        >
          <HouseholdSettings {...props} onError={() => {}} />
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

const texts = (html: string) => elementsOf(html).map(textOf);

describe("HouseholdSettings", () => {
  it("gives the admin an access select and says how many copies the default affects", () => {
    const html = render({
      isAdmin: true,
      defaultCopyPermission: "view",
      copiesUsingDefault: 23,
    });
    const els = elementsOf(html);
    expect(texts(html)).toContain("Household settings");
    expect(texts(html)).toContain(
      "Applies to 23 copies that use the household default",
    );
    const trigger = els.find((e) => attr(e, "role") === "combobox");
    // Radix renders the selected value client-side only, so SSR checks the labelled trigger.
    expect(trigger && attr(trigger, "aria-labelledby")).toBe(
      "household-default-label",
    );
    expect(texts(html)).not.toContain(
      "Only the household admin can change this.",
    );
  });

  it("shows members the default read-only", () => {
    const html = render({
      isAdmin: false,
      defaultCopyPermission: "manage",
      copiesUsingDefault: 1,
    });
    const els = elementsOf(html);
    expect(els.some((e) => attr(e, "role") === "combobox")).toBe(false);
    expect(texts(html)).toContain("Can manage");
    expect(texts(html)).toContain(
      "Applies to 1 copy that uses the household default",
    );
    expect(texts(html)).toContain("Only the household admin can change this.");
  });

  it("is translated to Dutch", () => {
    const html = render(
      { isAdmin: false, defaultCopyPermission: "view", copiesUsingDefault: 2 },
      "nl",
    );
    expect(texts(html)).toContain("Instellingen huishouden");
    expect(texts(html)).toContain("Alleen bekijken");
  });
});
