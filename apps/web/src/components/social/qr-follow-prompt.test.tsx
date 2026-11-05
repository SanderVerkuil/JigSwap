import { gateway, type Id } from "@/gateway";
import { convexQuery, ConvexQueryClient } from "@convex-dev/react-query";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ConvexProviderWithAuth, ConvexReactClient } from "convex/react";
import type { FunctionReturnType } from "convex/server";
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

type Relation = FunctionReturnType<typeof gateway.social.followRelation>;

const memberId = "owner1" as Id<"users">;
const none: Relation = {
  following: false,
  followsYou: false,
  targetIsPrivate: false,
  pendingRequest: null,
};
const privateOwner: Relation = { ...none, targetIsPrivate: true };

// No network: SSR never runs effects, so the prompt only reads the seeded relation (`undefined`
// leaves it unresolved, as while the query loads).
const render = (relation: Relation | undefined, locale: "en" | "nl" = "en") => {
  const convex = new ConvexReactClient("https://example.convex.cloud");
  const convexQueryClient = new ConvexQueryClient(convex);
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { queryKeyHashFn: convexQueryClient.hashFn() },
    },
  });
  if (relation !== undefined) {
    queryClient.setQueryData(
      convexQuery(gateway.social.followRelation, { memberId }).queryKey,
      relation,
    );
  }
  return renderToStaticMarkup(
    <ConvexProviderWithAuth client={convex} useAuth={useSignedIn}>
      <QueryClientProvider client={queryClient}>
        <IntlProvider
          locale={locale}
          messages={locale === "en" ? en : nl}
          timeZone="Europe/Amsterdam"
        >
          <QrFollowPrompt token="tok" name="Ann" memberId={memberId} />
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

const MUTUAL_PROMPT = "Ann shared their code with you — follow each other?";
const REQUEST_PROMPT =
  "Ann shared their code with you. Their profile is private, so this sends them a follow request.";

// The copy must promise what social/acceptQrFollow will do for this viewer, so it follows the
// server's rule (private owner who doesn't follow the viewer -> request, else mutual follow), and
// the prompt stays away when a tap would change nothing.
describe("QrFollowPrompt", () => {
  it("public profile: offers to follow each other", () => {
    const html = render(none);
    expect(textsOf(html, "p")).toEqual([MUTUAL_PROMPT]);
    expect(textsOf(html, "button")).toEqual(["Follow each other"]);
  });

  it("public profile the viewer already follows: the tap still follows each other", () => {
    const html = render({ ...none, following: true });
    expect(textsOf(html, "button")).toEqual(["Follow each other"]);
  });

  it("private profile: says the tap only sends a follow request", () => {
    const html = render(privateOwner);
    expect(textsOf(html, "p")).toEqual([REQUEST_PROMPT]);
    expect(textsOf(html, "button")).toEqual(["Request to follow"]);
  });

  it("private owner who already follows the viewer: offers to follow each other", () => {
    const html = render({ ...privateOwner, followsYou: true });
    expect(textsOf(html, "p")).toEqual([MUTUAL_PROMPT]);
    expect(textsOf(html, "button")).toEqual(["Follow each other"]);
  });

  it("stays away when a tap would change nothing", () => {
    // The viewer already follows a private owner who doesn't follow back: the server does nothing.
    expect(render({ ...privateOwner, following: true })).toBe("");
    // A request (or a masked decline) is already waiting on the owner.
    expect(
      render({
        ...privateOwner,
        pendingRequest: { requestId: "r1", requestedAt: 1 },
      }),
    ).toBe("");
    // Already following each other.
    expect(render({ ...none, following: true, followsYou: true })).toBe("");
    expect(render({ ...privateOwner, following: true, followsYou: true })).toBe(
      "",
    );
    // The viewer blocked the owner: every token path is refused.
    expect(render({ ...none, blockedByMe: true })).toBe("");
  });

  it("renders nothing until the relation is known", () => {
    expect(render(undefined)).toBe("");
  });

  it("speaks Dutch for both states", () => {
    expect(textsOf(render(none, "nl"), "button")).toEqual(["Elkaar volgen"]);
    const request = render(privateOwner, "nl");
    expect(textsOf(request, "p")).toEqual([
      "Ann heeft hun code met je gedeeld. Hun profiel is privé, dus hiermee stuur je een volgverzoek.",
    ]);
    expect(textsOf(request, "button")).toEqual(["Volgverzoek sturen"]);
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
