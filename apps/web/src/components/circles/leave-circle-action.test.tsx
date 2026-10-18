import { ConvexQueryClient } from "@convex-dev/react-query";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ConvexProviderWithAuth, ConvexReactClient } from "convex/react";
import { parseFragment, type DefaultTreeAdapterMap } from "parse5";
import { renderToStaticMarkup } from "react-dom/server";
import { createTranslator, IntlProvider } from "use-intl";
import { describe, expect, it } from "vitest";
import en from "../../../locales/en.json";
import nl from "../../../locales/nl.json";
import source from "../../../locales/source.json";
import { LeaveCircleAction } from "./leave-circle-action";

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
          <LeaveCircleAction circleId="circle-1" circleName="Family" />
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

const trigger = (html: string) => {
  const buttons = elementsOf(html).filter((el) => el.tagName === "button");
  expect(buttons).toHaveLength(1);
  return buttons[0];
};

describe("LeaveCircleAction", () => {
  it("renders a labelled, destructive trigger that opens the confirm (en)", () => {
    const button = trigger(render("en"));
    // The meaning is carried by text, not colour alone.
    expect(textOf(button)).toBe("Leave circle");
    expect(attr(button, "class")).toContain("text-destructive");
    expect(attr(button, "aria-haspopup")).toBe("dialog");
  });

  it("is translated (nl)", () => {
    expect(textOf(trigger(render("nl")))).toBe("Kring verlaten");
  });

  it("names the circle in the confirm title in every catalog", () => {
    const title = (messages: typeof en, locale: string) =>
      createTranslator({ locale, messages, namespace: "circles" })(
        "leaveConfirmTitle",
        { circle: "Family" },
      );
    expect(title(en, "en")).toBe("Leave Family?");
    expect(title(source, "en")).toBe("Leave Family?");
    expect(title(nl, "nl")).toBe("Family verlaten?");
    expect(nl.circles.leaveConfirmBody).toBe(
      "Je verliest de toegang tot deze kring en de puzzels die erin gedeeld zijn. Een beheerder kan je opnieuw uitnodigen.",
    );
    expect(en.circles.leaveConfirmBody).toBe(
      "You'll lose access to this circle and the puzzles shared in it. An admin can invite you again.",
    );
    expect(source.circles).toEqual(en.circles);
  });
});
