import { gateway, type Id } from "@/gateway";
import { ConvexQueryClient, convexQuery } from "@convex-dev/react-query";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ConvexProviderWithAuth, ConvexReactClient } from "convex/react";
import { parseFragment, type DefaultTreeAdapterMap } from "parse5";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { IntlProvider } from "use-intl";
import { describe, expect, it, vi } from "vitest";
import en from "../../../locales/en.json";
import nl from "../../../locales/nl.json";
import { MemberTile } from "./member-tile";

// Router-free Link/useNavigate: the test asserts the card's DOM, not routing.
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
  useNavigate: () => () => Promise.resolve(),
}));

// Signed out: useCurrentMember skips, so MessageButton renders its (disabled) loading state.
const useSignedOut = () => ({
  isLoading: false,
  isAuthenticated: false,
  fetchAccessToken: async () => null,
});

const memberId = "member1" as Id<"users">;

type Seed = {
  member?: Record<string, unknown>;
  stats?: Record<string, unknown> | null;
  relation?: Record<string, unknown>;
};

const render = (
  seed: Seed,
  props: { followsYou?: boolean; hideLocation?: boolean } = {},
  locale: "en" | "nl" = "en",
) => {
  // No network: SSR never runs effects, so queries only read the seeded cache.
  const convex = new ConvexReactClient("https://example.convex.cloud");
  const convexQueryClient = new ConvexQueryClient(convex);
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { queryKeyHashFn: convexQueryClient.hashFn() },
    },
  });
  const seedQuery = (key: readonly unknown[], data: unknown) =>
    queryClient.setQueryData(key, data);
  seedQuery(
    convexQuery(gateway.identity.byId, { userId: memberId }).queryKey,
    seed.member ?? {
      _id: memberId,
      name: "Hans-Peter van den Berg",
      username: "hans",
      location: "Utrecht",
    },
  );
  if (seed.stats !== undefined) {
    seedQuery(
      convexQuery(gateway.identity.userStats, { userId: memberId }).queryKey,
      seed.stats,
    );
  }
  seedQuery(
    convexQuery(gateway.social.followRelation, { memberId }).queryKey,
    seed.relation ?? {
      following: true,
      followsYou: true,
      targetIsPrivate: false,
      pendingRequest: null,
    },
  );
  return renderToStaticMarkup(
    <ConvexProviderWithAuth client={convex} useAuth={useSignedOut}>
      <QueryClientProvider client={queryClient}>
        <IntlProvider
          locale={locale}
          messages={locale === "en" ? en : nl}
          timeZone="Europe/Amsterdam"
        >
          <MemberTile memberId={memberId} followsYou={false} {...props} />
        </IntlProvider>
      </QueryClientProvider>
    </ConvexProviderWithAuth>,
  );
};

const rated = {
  puzzlesOwned: 12,
  puzzlesAvailable: 12,
  tradesCompleted: 3,
  averageRating: 4.8,
  totalReviews: 12,
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

const classes = (el: Element) => (attr(el, "class") ?? "").split(/\s+/);

const textOf = (el: Element): string =>
  el.childNodes
    .map((child) =>
      isElement(child) ? textOf(child) : "value" in child ? child.value : "",
    )
    .join("");

const hasAncestor = (el: Element, tagName: string) => {
  for (let p = el.parentNode; p && "tagName" in p; p = p.parentNode) {
    if (p.tagName === tagName) return true;
  }
  return false;
};

const byLabel = (els: Element[], label: string) =>
  els.find((el) => attr(el, "aria-label") === label);

describe("MemberTile", () => {
  it("has exactly one link — the name — stretched over the card, with only text inside", () => {
    const html = render({ stats: rated });
    const anchors = elementsOf(html).filter((el) => el.tagName === "a");
    expect(anchors).toHaveLength(1);
    const link = anchors[0]!;
    expect(attr(link, "href")).toBe("/members/hans");
    expect(attr(link, "title")).toBe("Hans-Peter van den Berg");
    expect(classes(link)).toContain("after:inset-0");
    // Only text inside the link: no nested elements (buttons, links, ...).
    expect(link.childNodes.every((child) => !isElement(child))).toBe(true);
    expect(textOf(link)).toBe("Hans-Peter van den Berg");
  });

  it("does not nest the action buttons inside the link", () => {
    const html = render({ stats: rated });
    const buttons = elementsOf(html).filter((el) => el.tagName === "button");
    expect(buttons.length).toBeGreaterThan(0);
    for (const button of buttons) {
      expect(hasAncestor(button, "a")).toBe(false);
    }
    // Actions sit above the stretched-link overlay.
    const wrapper = buttons[0]!.parentNode as Element;
    expect(classes(wrapper)).toEqual(
      expect.arrayContaining(["relative", "z-10"]),
    );
  });

  it("labels the icon actions with the member's name", () => {
    const html = render({ stats: rated });
    const els = elementsOf(html);
    expect(byLabel(els, "Unfollow Hans-Peter van den Berg")?.tagName).toBe(
      "button",
    );
    expect(byLabel(els, "Message Hans-Peter van den Berg")?.tagName).toBe(
      "button",
    );
  });

  it("describes the link with the meta line and the stats", () => {
    const html = render({ stats: rated }, { followsYou: true });
    const els = elementsOf(html);
    const link = els.find((el) => el.tagName === "a")!;
    const ids = (attr(link, "aria-describedby") ?? "").split(" ");
    expect(ids).toHaveLength(2);
    for (const id of ids) {
      expect(els.some((el) => attr(el, "id") === id)).toBe(true);
    }
    expect(html).toContain("Follows you");
    expect(html).toContain("Utrecht");
  });

  it("shows 'No reviews yet' and no star when the member is unreviewed", () => {
    const html = render({
      stats: { ...rated, totalReviews: 0, averageRating: 0 },
    });
    expect(html).toContain("No reviews yet");
    expect(html).not.toContain("lucide-star");
    expect(html).not.toContain("–");
  });

  it("formats the rating per locale with a spoken description", () => {
    const html = render({ stats: rated }, {}, "nl");
    expect(html).toContain("4,8");
    expect(html).toContain("Gemiddelde beoordeling 4,8 van 5 uit 12 reviews");
    expect(html).toContain("lucide-star");
  });

  it("omits the location on discovery surfaces and the meta line when empty", () => {
    const html = render({ stats: rated }, { hideLocation: true });
    expect(html).not.toContain("Utrecht");
    const link = elementsOf(html).find((el) => el.tagName === "a")!;
    expect(attr(link, "aria-describedby")?.split(" ")).toHaveLength(1);
  });

  it("uses the filled Follow CTA when not following, and drops empty descriptions", () => {
    const html = render(
      {
        stats: null,
        relation: {
          following: false,
          followsYou: false,
          targetIsPrivate: false,
          pendingRequest: null,
        },
      },
      { hideLocation: true },
    );
    const els = elementsOf(html);
    const follow = byLabel(els, "Follow Hans-Peter van den Berg");
    expect(follow?.tagName).toBe("button");
    expect(classes(follow!)).toContain("bg-primary");
    // Private stats and no meta line: nothing to describe the link with.
    expect(els.some((el) => attr(el, "aria-describedby") !== undefined)).toBe(
      false,
    );
  });

  it("keeps the Requested state a dropdown trigger with a qualified label", () => {
    const html = render({
      stats: rated,
      relation: {
        following: false,
        followsYou: false,
        targetIsPrivate: true,
        pendingRequest: { requestId: "r1", requestedAt: Date.now() },
      },
    });
    const trigger = byLabel(
      elementsOf(html),
      "Follow request to Hans-Peter van den Berg pending",
    );
    expect(trigger?.tagName).toBe("button");
    expect(attr(trigger!, "aria-haspopup")).toBe("menu");
    expect(html).toContain("lucide-clock");
  });

  it("keeps the avatar decorative", () => {
    const html = render({
      stats: rated,
      member: {
        _id: memberId,
        name: "Hans-Peter van den Berg",
        username: "hans",
        avatar: "https://example.com/a.png",
      },
    });
    const avatar = elementsOf(html).find(
      (el) => attr(el, "data-slot") === "avatar",
    );
    expect(avatar && attr(avatar, "aria-hidden")).toBe("true");
  });
});
