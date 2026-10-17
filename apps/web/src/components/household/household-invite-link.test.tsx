import { ConvexQueryClient } from "@convex-dev/react-query";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ConvexProviderWithAuth, ConvexReactClient } from "convex/react";
import { parseFragment, type DefaultTreeAdapterMap } from "parse5";
import { renderToStaticMarkup } from "react-dom/server";
import { IntlProvider } from "use-intl";
import { describe, expect, it } from "vitest";
import en from "../../../locales/en.json";
import nl from "../../../locales/nl.json";
import { HouseholdInviteLink } from "./household-invite-link";

const useSignedOut = () => ({
  isLoading: false,
  isAuthenticated: false,
  fetchAccessToken: async () => null,
});

const render = (locale: "en" | "nl" = "en") => {
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
          <HouseholdInviteLink memberId="m1" />
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

describe("HouseholdInviteLink", () => {
  it("offers to create a link, says it works once for 14 days, and can revoke", () => {
    const html = render();
    const all = texts(html);
    expect(all).toContain("Invite with a link");
    expect(all).toContain("The link works once and expires in 14 days.");
    const buttons = elementsOf(html).filter((el) => el.tagName === "button");
    expect(buttons.map(textOf)).toEqual([
      "Create invite link",
      "Revoke open links",
    ]);
  });

  it("renders in Dutch", () => {
    const all = texts(render("nl"));
    expect(all).toContain("Uitnodigen met een link");
    expect(all).toContain("Uitnodigingslink maken");
    expect(all).toContain("De link werkt één keer en verloopt na 14 dagen.");
  });
});
