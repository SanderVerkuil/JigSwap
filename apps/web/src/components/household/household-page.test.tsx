import type { PageHeaderContent } from "@/components/dashboard-layout/page-header-slot";
import { ConvexQueryClient } from "@convex-dev/react-query";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ConvexProviderWithAuth, ConvexReactClient } from "convex/react";
import {
  parseFragment,
  serializeOuter as serializeOuterHtml,
  type DefaultTreeAdapterMap,
} from "parse5";
import type { ComponentProps, ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { IntlProvider } from "use-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import en from "../../../locales/en.json";
import nl from "../../../locales/nl.json";
import {
  HouseholdDetails,
  NoHousehold,
  type HouseholdData,
  type HouseholdTab,
} from "./household-page";

// Server rendering always reads useIsMobile's server snapshot (false); phones are opted in per test.
const viewport = vi.hoisted(() => ({ mobile: false }));
vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => viewport.mobile }));

// The shell's page head renders what the page publishes; capture it so tests can render it too.
const pageHead = vi.hoisted(() => ({
  content: undefined as PageHeaderContent | undefined,
}));
vi.mock("@/components/dashboard-layout/page-header-slot", () => ({
  usePageHeader: (factory: () => PageHeaderContent) => {
    pageHead.content = factory();
  },
}));

// The real button reads the router's location; the page only decides which guide and where.
vi.mock("@/components/tour/guide-help-button", () => ({
  GuideHelpButton: ({ tourId }: { tourId: string }) => (
    <button type="button" aria-label="Show me how" data-guide={tourId} />
  ),
}));

const useSignedOut = () => ({
  isLoading: false,
  isAuthenticated: false,
  fetchAccessToken: async () => null,
});

const renderHtml = (node: ReactNode, locale: "en" | "nl" = "en") => {
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
const serializeOuter = (el: Element) => serializeOuterHtml(el);

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
  joinRequests: [],
  defaultCopyPermission: "view",
  copiesUsingDefault: 4,
});

const details = (
  viewerRole: "admin" | "member",
  activeTab: HouseholdTab,
  invites: ComponentProps<typeof HouseholdDetails>["invites"] = [],
  locale: "en" | "nl" = "en",
) =>
  renderHtml(
    <HouseholdDetails
      household={household(viewerRole)}
      invites={invites}
      activeTab={activeTab}
      onTabChange={() => {}}
      onError={() => {}}
    />,
    locale,
  );

const EXPLAINER =
  "Everyone in your household sees each other's puzzles in My puzzles. Puzzles stay owned by whoever added them; owners choose per puzzle whether the household can manage it (edit, lend, swap) or only view it. Solves stay personal.";

const guideButtons = (html: string) =>
  elementsOf(html).filter((e) => attr(e, "aria-label") === "Show me how");

describe("HouseholdDetails", () => {
  afterEach(() => {
    viewport.mobile = false;
    pageHead.content = undefined;
  });

  it("shows four tabs, Puzzles first, with no identity strip above them", () => {
    const html = details("admin", "puzzles");
    const tabs = elementsOf(html).filter((e) => attr(e, "role") === "tab");
    expect(tabs.map(textOf)).toEqual([
      "Puzzles",
      "Members2",
      "Access",
      "Settings",
    ]);
    expect(attr(tabs[0], "aria-selected")).toBe("true");
    // The member count lives on the Members tab; no avatar row or "2 members" line.
    expect(texts(html)).not.toContain("2 members");
    // The tour steps target always-mounted elements: the tab bar and the Access trigger.
    expect(attr(tabs[2], "data-tour")).toBe("household-my-copies");
    const main = elementsOf(html).filter(
      (e) => attr(e, "data-tour") === "household-main",
    );
    expect(main).toHaveLength(1);
    expect(
      elementsOf(serializeOuter(main[0])).some(
        (e) => attr(e, "role") === "tablist",
      ),
    ).toBe(true);
  });

  const inviteButtons = (html: string) =>
    elementsOf(html).filter(
      (e) => e.tagName === "button" && textOf(e) === "Invite",
    );

  it("keeps the admin's Invite out of the Members list from md (it's in the page head)", () => {
    const html = details("admin", "members");
    expect(inviteButtons(html)).toHaveLength(0);
    const tabs = elementsOf(html).filter((e) => attr(e, "role") === "tab");
    expect(attr(tabs[1], "data-tour")).toBeUndefined();
  });

  it("puts the admin's Invite at the top of the Members list on phones", () => {
    viewport.mobile = true;
    const html = details("admin", "members");
    const [invite] = inviteButtons(html);
    expect(invite).toBeDefined();
    // Above the first member.
    const all = texts(html);
    expect(all.indexOf("Invite")).toBeLessThan(all.indexOf("Ann"));
    // The Invite button lives in the (not always mounted) Members tab: the tour targets its trigger.
    const tabs = elementsOf(html).filter((e) => attr(e, "role") === "tab");
    expect(attr(tabs[1], "data-tour")).toBe("household-invite");
  });

  it("gives a member on a phone no Invite", () => {
    viewport.mobile = true;
    expect(inviteButtons(details("member", "members"))).toHaveLength(0);
  });

  it("gives the admin a per-member actions menu", () => {
    const html = details("admin", "members");
    const els = elementsOf(html);
    expect(
      els.filter((e) => attr(e, "aria-label")?.startsWith("Actions for")),
    ).toHaveLength(1);
    expect(els.some((e) => attr(e, "aria-label") === "Actions for Bob")).toBe(
      true,
    );
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
    expect(texts(html)).toContain(
      "Only the household admin can invite people.",
    );
    // The tour's invite step targets the always-mounted Members trigger for members.
    const tabs = els.filter((e) => attr(e, "role") === "tab");
    expect(attr(tabs[1], "data-tour")).toBe("household-invite");
    expect(texts(html)).not.toContain("Waiting for a response");
  });

  it("explains who sees what above the tabs, whichever tab is open", () => {
    for (const tab of ["puzzles", "members", "sharing", "settings"] as const) {
      const els = elementsOf(details("member", tab));
      const explainer = els.findIndex(
        (e) => e.tagName === "p" && textOf(e) === EXPLAINER,
      );
      const tablist = els.findIndex((e) => attr(e, "role") === "tablist");
      expect(explainer, tab).toBeGreaterThanOrEqual(0);
      expect(explainer, tab).toBeLessThan(tablist);
      expect(
        els.filter((e) => textOf(e) === EXPLAINER),
        tab,
      ).toHaveLength(1);
    }
  });

  it("puts the who-sees-what guide in the page head from md, before the admin's Invite", () => {
    const html = details("admin", "puzzles");
    // Not in the page body: one guide button at a time.
    expect(guideButtons(html)).toHaveLength(0);
    const head = elementsOf(renderHtml(<>{pageHead.content?.actions}</>));
    const buttons = head.filter((e) => e.tagName === "button");
    expect(buttons.map((b) => attr(b, "data-guide") ?? textOf(b))).toEqual([
      "who-sees-what",
      "Invite",
    ]);
  });

  it("gives a member the guide alone in the page head from md", () => {
    details("member", "members");
    const head = elementsOf(renderHtml(<>{pageHead.content?.actions}</>));
    expect(
      head
        .filter((e) => e.tagName === "button")
        .map((b) => attr(b, "data-guide")),
    ).toEqual(["who-sees-what"]);
  });

  it("on phones ends the explainer with the guide and publishes no page-head actions", () => {
    viewport.mobile = true;
    for (const role of ["admin", "member"] as const) {
      const html = details(role, "settings");
      // Nothing for the shell to put on a row of its own above the page.
      expect(pageHead.content?.actions, role).toBeUndefined();
      const [guide] = guideButtons(html);
      expect(attr(guide, "data-guide"), role).toBe("who-sees-what");
      expect(guideButtons(html), role).toHaveLength(1);
      // Inside the explainer itself, after its text: it never takes a row of its own.
      const explainer = elementsOf(html).find(
        (e) => e.tagName === "p" && textOf(e) === EXPLAINER,
      );
      expect(explainer, role).toBeDefined();
      expect(
        elementsOf(serializeOuter(explainer!)).map((e) =>
          attr(e, "data-guide"),
        ),
      ).toContain("who-sees-what");
    }
  });

  it("names the tab after the access it sets, not the circles' Share", () => {
    // Circles "share" a puzzle (who sees it); this tab sets what housemates may do with it, in
    // the "access" words its own controls use. It keeps its ?tab=sharing value, so links and the
    // tour's anchor still work.
    const nlTabs = elementsOf(details("member", "sharing", [], "nl")).filter(
      (e) => attr(e, "role") === "tab",
    );
    expect(textOf(nlTabs[2])).toBe("Toegang");
    expect(attr(nlTabs[2], "aria-selected")).toBe("true");
    expect(attr(nlTabs[2], "data-tour")).toBe("household-my-copies");
  });

  it("puts the default line on the Access tab", () => {
    const html = details("member", "sharing");
    expect(texts(html)).toContain("Household default: View only");
  });

  it("puts settings and the leave danger zone on the Settings tab", () => {
    const html = details("member", "settings");
    expect(texts(html)).toContain("Household settings");
    expect(texts(html)).toContain("Leave this household");
    expect(texts(html)).toContain("Leave household");
  });
});

describe("HouseholdDetails with an invite from another household", () => {
  it("offers Leave and join or Decline above the household, on every tab", () => {
    const invite = {
      inviteId: "i_9",
      inviter: { memberId: "u_frank", name: "Frank" },
      createdAt: 1,
    };
    for (const tab of ["members", "settings"] as const) {
      const html = details("member", tab, [invite]);
      const all = texts(html);
      expect(all).toContain("Frank invited you to their household");
      expect(all).toContain(
        "You're already in your current household. You can be in one household at a time, so joining means leaving it.",
      );
      const buttons = elementsOf(html)
        .filter((e) => e.tagName === "button")
        .map(textOf);
      expect(buttons).toContain("Leave and join");
      expect(buttons).toContain("Decline");
    }
  });

  it("shows no switch card without invites", () => {
    expect(texts(details("member", "members"))).not.toContain("Leave and join");
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
