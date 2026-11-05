import type { IncomingFollowRequestView } from "@jigswap/contracts";
import { parseFragment, type DefaultTreeAdapterMap } from "parse5";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { IntlProvider } from "use-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import en from "../../../locales/en.json";
import { FollowRequestsStrip } from "./follow-requests-strip";

// The strip's one query returns the seeded requests; mutations are inert.
const data = vi.hoisted(() => ({
  requests: [] as IncomingFollowRequestView[],
}));
vi.mock("@/gateway", () => ({
  gateway: { social: {} },
}));
vi.mock("@convex-dev/react-query", () => ({
  convexQuery: () => ({}),
  useConvexMutation: () => vi.fn(),
}));
vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({ data: data.requests }),
  useMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
// Router-free Link: the test asserts the row's DOM, not routing.
vi.mock("@tanstack/react-router", () => ({
  Link: ({
    to,
    params,
    children,
    ...rest
  }: {
    to: string;
    params?: Record<string, string>;
    children?: ReactNode;
  }) => (
    <a
      href={Object.entries(params ?? {}).reduce(
        (path, [key, value]) => path.replace(`$${key}`, value),
        to,
      )}
      {...rest}
    >
      {children}
    </a>
  ),
}));

afterEach(() => {
  data.requests = [];
});

const request = (
  requester: IncomingFollowRequestView["requester"],
): IncomingFollowRequestView => ({
  requestId: `req-${requester.memberId}`,
  requestedAt: 0,
  requester,
  alreadyFollowing: false,
});

const render = () =>
  renderToStaticMarkup(
    <IntlProvider locale="en" messages={en} timeZone="Europe/Amsterdam">
      <FollowRequestsStrip />
    </IntlProvider>,
  );

type Node = DefaultTreeAdapterMap["childNode"];
type Element = DefaultTreeAdapterMap["element"];
const isElement = (node: Node): node is Element => "tagName" in node;
const links = (html: string) => {
  const out: { href?: string; text: string }[] = [];
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
  const walk = (nodes: Node[]) => {
    for (const node of nodes) {
      if (!isElement(node)) continue;
      if (node.tagName === "a") {
        out.push({
          href: node.attrs.find((a) => a.name === "href")?.value,
          text: textOf(node),
        });
      }
      walk(node.childNodes);
    }
  };
  walk(parseFragment(html).childNodes);
  return out;
};

// SEC-11: a requester arrives as a teaser identity (display name, handle, avatar), never a full
// member view; the link uses the slug, else the id, never the username (SEC-07).
describe("FollowRequestsStrip", () => {
  it("names each requester by display name and links their slug, else their id", () => {
    data.requests = [
      request({
        memberId: "u1",
        displayName: "Pseudonym",
        username: "realname",
        slug: "pseudo",
      }),
      request({ memberId: "u2", displayName: "Ann", username: "ann" }),
    ];
    expect(links(render())).toEqual([
      { href: "/members/pseudo", text: "Pseudonym" },
      { href: "/members/u2", text: "Ann" },
    ]);
  });

  it("falls back to the generic member label without a display name", () => {
    data.requests = [request({ memberId: "u3" })];
    expect(links(render())).toEqual([{ href: "/members/u3", text: "Puzzler" }]);
  });

  it("keeps a working link and name from a backend that predates the teaser view (deploy skew)", () => {
    // The pre-SEC-11 backend sends the requester as a MemberView: `_id` and `name`, no `memberId`.
    const legacy = { _id: "u4", name: "Old Shape", username: "oldshape" };
    data.requests = [
      request(legacy as unknown as IncomingFollowRequestView["requester"]),
    ];
    expect(links(render())).toEqual([
      { href: "/members/u4", text: "Old Shape" },
    ]);
  });
});
