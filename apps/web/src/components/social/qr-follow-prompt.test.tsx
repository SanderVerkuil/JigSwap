import { ConvexQueryClient } from "@convex-dev/react-query";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ConvexProviderWithAuth, ConvexReactClient } from "convex/react";
import { parseFragment, type DefaultTreeAdapterMap } from "parse5";
import { renderToStaticMarkup } from "react-dom/server";
import { IntlProvider } from "use-intl";
import { describe, expect, it } from "vitest";
import en from "../../../locales/en.json";
import nl from "../../../locales/nl.json";
import { QrFollowPrompt, qrFollowToastKey } from "./qr-follow-prompt";

const useSignedIn = () => ({
  isLoading: false,
  isAuthenticated: true,
  fetchAccessToken: async () => null,
});

const render = (locked: boolean, locale: "en" | "nl") => {
  const convex = new ConvexReactClient("https://example.convex.cloud");
  const convexQueryClient = new ConvexQueryClient(convex);
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        queryKeyHashFn: convexQueryClient.hashFn(),
        queryFn: convexQueryClient.queryFn(),
      },
    },
  });
  return renderToStaticMarkup(
    <ConvexProviderWithAuth client={convex} useAuth={useSignedIn}>
      <QueryClientProvider client={queryClient}>
        <IntlProvider
          locale={locale}
          messages={locale === "en" ? en : nl}
          timeZone="Europe/Amsterdam"
        >
          <QrFollowPrompt token="tok" name="Ann" locked={locked} />
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
const textsOf = (html: string, tagName: string) =>
  elementsOf(html)
    .filter((el) => el.tagName === tagName)
    .map(textOf);

describe("QrFollowPrompt", () => {
  it("public profile: offers to follow each other", () => {
    const html = render(false, "en");
    expect(textsOf(html, "p")).toEqual([
      "Ann shared their code with you — follow each other?",
    ]);
    expect(textsOf(html, "button")).toEqual(["Follow each other"]);
  });

  it("private profile: says the tap only sends a follow request", () => {
    const html = render(true, "en");
    expect(textsOf(html, "p")).toEqual([
      "Ann shared their code with you. Their profile is private, so this sends them a follow request.",
    ]);
    expect(textsOf(html, "button")).toEqual(["Request to follow"]);
  });

  it("speaks Dutch for both states", () => {
    expect(textsOf(render(false, "nl"), "button")).toEqual(["Elkaar volgen"]);
    const locked = render(true, "nl");
    expect(textsOf(locked, "p")).toEqual([
      "Ann heeft hun code met je gedeeld. Hun profiel is privé, dus hiermee stuur je een volgverzoek.",
    ]);
    expect(textsOf(locked, "button")).toEqual(["Volgverzoek sturen"]);
  });
});

describe("qrFollowToastKey", () => {
  it("reports a new follow, a sent request, or nothing", () => {
    expect(qrFollowToastKey({ established: true })).toBe("followEstablished");
    expect(qrFollowToastKey({ established: false, requested: true })).toBe(
      "followRequestSent",
    );
    expect(qrFollowToastKey({ established: false })).toBeNull();
  });
});
