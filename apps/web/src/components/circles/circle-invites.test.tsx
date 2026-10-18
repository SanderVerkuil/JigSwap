import { ConvexQueryClient } from "@convex-dev/react-query";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ConvexProviderWithAuth, ConvexReactClient } from "convex/react";
import { parseFragment, type DefaultTreeAdapterMap } from "parse5";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { IntlProvider } from "use-intl";
import { describe, expect, it } from "vitest";
import en from "../../../locales/en.json";
import nl from "../../../locales/nl.json";
import source from "../../../locales/source.json";
import {
  CircleInvitationList,
  type MyCircleInvite,
} from "./circle-invitations";
import {
  InvitableMemberList,
  type InvitableMember,
} from "./circle-invite-picker";
import {
  PendingInviteList,
  type PendingCircleInvite,
} from "./circle-pending-invites";

const NOW = new Date("2026-10-18T10:00:00Z");
const DAY = 24 * 60 * 60 * 1000;
const EXPIRES = Date.parse("2026-11-01T10:00:00Z");

const useSignedOut = () => ({
  isLoading: false,
  isAuthenticated: false,
  fetchAccessToken: async () => null,
});

const render = (ui: ReactNode, locale: "en" | "nl" = "en") => {
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
          now={NOW}
        >
          {ui}
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

const byTag = (html: string, tag: string) =>
  elementsOf(html).filter((el) => el.tagName === tag);

const buttonLabels = (html: string) =>
  byTag(html, "button").map((b) => textOf(b));

const member = (id: string, name?: string) => ({
  _id: id,
  _creationTime: 0,
  name,
  isActive: true,
  createdAt: 0,
  updatedAt: 0,
});

const noop = () => {};

const invites = [
  {
    inviteId: "invite-1",
    circleName: "Saturday Puzzlers",
    memberCount: 4,
    inviter: { anonymous: false, member: member("u-alice", "Alice") },
    permission: "Exchange",
    expiresAt: EXPIRES,
  },
  {
    inviteId: "invite-2",
    circleName: "Family",
    memberCount: 1,
    inviter: { anonymous: true, anonRef: "anon-1" },
    permission: "ViewOnly",
    expiresAt: EXPIRES,
  },
] as unknown as MyCircleInvite[];

describe("CircleInvitationList", () => {
  const html = (locale: "en" | "nl" = "en", highlightInviteId?: string) =>
    render(
      <CircleInvitationList
        invites={invites}
        highlightInviteId={highlightInviteId}
        onAccept={noop}
        onDecline={noop}
      />,
      locale,
    );

  it("renders an Accept and a Decline button per invitation (en)", () => {
    expect(buttonLabels(html())).toEqual([
      "Accept",
      "Decline",
      "Accept",
      "Decline",
    ]);
    expect(textOf(byTag(html(), "h2")[0])).toBe("Invitations");
  });

  it("shows the circle, the projected inviter, the size and the expiry", () => {
    const rows = byTag(html(), "li");
    expect(rows).toHaveLength(2);
    expect(textOf(rows[0])).toContain("Saturday Puzzlers");
    expect(textOf(rows[0])).toContain(
      "Invited by Alice · 4 members · Expires Nov 1, 2026",
    );
    // An anonymised inviter renders as the generic member label, never a fabricated name.
    expect(textOf(rows[1])).toContain(
      "Invited by Puzzler · 1 member · Expires Nov 1, 2026",
    );
  });

  it("is translated (nl)", () => {
    const markup = html("nl");
    expect(buttonLabels(markup)).toEqual([
      "Accepteren",
      "Weigeren",
      "Accepteren",
      "Weigeren",
    ]);
    expect(textOf(byTag(markup, "li")[1])).toContain(
      "Uitgenodigd door Puzzelaar · 1 lid · Verloopt 1 nov 2026",
    );
  });

  it("marks only the deep-linked invitation as highlighted and focusable", () => {
    const rows = byTag(html("en", "invite-2"), "li");
    expect(attr(rows[0], "data-highlighted")).toBeUndefined();
    expect(attr(rows[0], "tabindex")).toBeUndefined();
    expect(attr(rows[1], "data-highlighted")).toBe("true");
    expect(attr(rows[1], "tabindex")).toBe("-1");
    expect(attr(rows[1], "class")).toContain("ring-2");
  });
});

const pending = [
  {
    inviteId: "invite-9",
    invitee: { anonymous: false, member: member("u-bob", "Bob") },
    invitedBy: { anonymous: false, member: member("u-alice", "Alice") },
    createdAt: NOW.getTime() - 2 * DAY,
    expiresAt: EXPIRES,
  },
] as unknown as PendingCircleInvite[];

describe("PendingInviteList", () => {
  it("lists each invitee with when they were invited, the expiry and a confirmed Revoke", () => {
    const markup = render(
      <PendingInviteList invites={pending} onRevoke={noop} />,
    );
    const rows = byTag(markup, "li");
    expect(rows).toHaveLength(1);
    expect(textOf(rows[0])).toContain("Bob");
    expect(textOf(rows[0])).toContain(
      "Invited 2 days ago · expires Nov 1, 2026",
    );
    const [revoke] = byTag(markup, "button");
    expect(textOf(revoke)).toBe("Revoke");
    // Revoke opens a confirm first.
    expect(attr(revoke, "aria-haspopup")).toBe("dialog");
  });

  it("is translated (nl)", () => {
    const markup = render(
      <PendingInviteList invites={pending} onRevoke={noop} />,
      "nl",
    );
    expect(textOf(byTag(markup, "li")[0])).toContain(
      "Uitgenodigd 2 dagen geleden · verloopt 1 nov 2026",
    );
    expect(buttonLabels(markup)).toEqual(["Intrekken"]);
  });
});

describe("InvitableMemberList", () => {
  it("explains who can be invited when there is no one to offer (en)", () => {
    const markup = render(
      <InvitableMemberList candidates={[]} onInvite={noop} />,
    );
    expect(byTag(markup, "button")).toHaveLength(0);
    expect(textOf(byTag(markup, "p")[0])).toBe(
      "You can invite people you follow mutually.",
    );
  });

  it("explains who can be invited (nl)", () => {
    const markup = render(
      <InvitableMemberList candidates={[]} onInvite={noop} />,
      "nl",
    );
    expect(textOf(byTag(markup, "p")[0])).toBe(
      "Je kunt mensen uitnodigen die je wederzijds volgt.",
    );
  });

  it("offers a Send invite button per candidate", () => {
    const candidates = [
      { anonymous: false, member: member("u-carol", "Carol") },
    ] as unknown as InvitableMember[];
    const markup = render(
      <InvitableMemberList candidates={candidates} onInvite={noop} />,
    );
    expect(markup).toContain("Carol");
    expect(buttonLabels(markup)).toEqual(["Send invite"]);
  });
});

describe("circle invite strings", () => {
  it("keep source in step with en", () => {
    expect(source.circles).toEqual(en.circles);
  });
});
