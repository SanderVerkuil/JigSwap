import { ConvexQueryClient } from "@convex-dev/react-query";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ConvexProviderWithAuth, ConvexReactClient } from "convex/react";
import { parseFragment, type DefaultTreeAdapterMap } from "parse5";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { IntlProvider } from "use-intl";
import { describe, expect, it } from "vitest";
import en from "../../../locales/en.json";
import {
  HouseholdDetails,
  NoHousehold,
  type HouseholdData,
  type HouseholdTab,
} from "./household-page";

const useSignedOut = () => ({
  isLoading: false,
  isAuthenticated: false,
  fetchAccessToken: async () => null,
});

const renderHtml = (node: ReactNode) => {
  const convex = new ConvexReactClient("https://example.convex.cloud");
  const convexQueryClient = new ConvexQueryClient(convex);
  const queryClient = new QueryClient({
    defaultOptions: { queries: { queryKeyHashFn: convexQueryClient.hashFn() } },
  });
  return renderToStaticMarkup(
    <ConvexProviderWithAuth client={convex} useAuth={useSignedOut}>
      <QueryClientProvider client={queryClient}>
        <IntlProvider locale="en" messages={en} timeZone="Europe/Amsterdam">
          {node}
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

const household = (viewerRole: "admin" | "member"): HouseholdData => ({
  householdId: "hh_1",
  viewerRole,
  members: [
    {
      memberId: "u_ann",
      name: "Ann",
      role: "admin",
      joinedAt: 1,
      isYou: viewerRole === "admin",
    },
    {
      memberId: "u_bob",
      name: "Bob",
      role: "member",
      joinedAt: 2,
      isYou: viewerRole === "member",
    },
  ],
  pendingInvites:
    viewerRole === "admin"
      ? [
          {
            inviteId: "i_1",
            invitee: { memberId: "u_cat", name: "Cat" },
            createdAt: 3,
          },
        ]
      : [],
  defaultCopyPermission: "view",
  copiesUsingDefault: 4,
});

const details = (viewerRole: "admin" | "member", activeTab: HouseholdTab) =>
  renderHtml(
    <HouseholdDetails
      household={household(viewerRole)}
      activeTab={activeTab}
      onTabChange={() => {}}
      onError={() => {}}
    />,
  );

describe("HouseholdDetails", () => {
  it("shows the identity strip and three tabs, Members first", () => {
    const html = details("admin", "members");
    const tabs = elementsOf(html).filter((e) => attr(e, "role") === "tab");
    expect(tabs.map(textOf)).toEqual([
      "Members2",
      "PuzzlesMy puzzles",
      "Settings",
    ]);
    expect(attr(tabs[0], "aria-selected")).toBe("true");
    expect(texts(html)).toContain("2 members");
    // The copy-access tour step targets the always-mounted tab trigger.
    expect(attr(tabs[1], "data-tour")).toBe("household-my-copies");
  });

  it("gives the admin a per-member actions menu and the pending invites", () => {
    const html = details("admin", "members");
    const els = elementsOf(html);
    expect(
      els.filter((e) => attr(e, "aria-label")?.startsWith("Actions for")),
    ).toHaveLength(1);
    expect(els.some((e) => attr(e, "aria-label") === "Actions for Bob")).toBe(
      true,
    );
    expect(texts(html)).toContain("Waiting for a response");
    expect(texts(html)).toContain("Cat");
    expect(texts(html)).not.toContain(
      "Only the household admin can invite people.",
    );
  });

  it("tells a member that only the admin invites, with no member actions", () => {
    const html = details("member", "members");
    const els = elementsOf(html);
    expect(
      els.some((e) => attr(e, "aria-label")?.startsWith("Actions for")),
    ).toBe(false);
    const note = els.find(
      (e) => textOf(e) === "Only the household admin can invite people.",
    );
    expect(note && attr(note, "data-tour")).toBe("household-invite");
    expect(texts(html)).not.toContain("Waiting for a response");
  });

  it("puts the default line on the My puzzles tab", () => {
    const html = details("member", "puzzles");
    expect(texts(html)).toContain("Household default: View only");
  });

  it("puts settings and the leave danger zone on the Settings tab", () => {
    const html = details("member", "settings");
    expect(texts(html)).toContain("Household settings");
    expect(texts(html)).toContain("Leave this household");
    expect(texts(html)).toContain("Leave household");
  });
});

describe("NoHousehold", () => {
  it("offers Create as the main action when nobody invited you", () => {
    const html = renderHtml(<NoHousehold invites={[]} onError={() => {}} />);
    const create = elementsOf(html).find(
      (e) => attr(e, "data-tour") === "household-main",
    );
    expect(create && textOf(create)).toBe("Create household");
  });

  it("puts invites first and Create as the quiet alternative", () => {
    const html = renderHtml(
      <NoHousehold
        invites={[
          {
            inviteId: "i_1",
            inviter: { memberId: "u_ann", name: "Ann" },
            createdAt: 1,
          },
        ]}
        onError={() => {}}
      />,
    );
    const all = texts(html);
    expect(all).toContain("Household invites");
    expect(all).toContain("Accept");
    expect(all.indexOf("Accept")).toBeLessThan(
      all.indexOf("Or start your own household"),
    );
  });
});
