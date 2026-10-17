import { gateway, type Id } from "@/gateway";
import { ConvexQueryClient, convexQuery } from "@convex-dev/react-query";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ConvexProviderWithAuth, ConvexReactClient } from "convex/react";
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

const parse = (html: string) => {
  const anchors = html.match(/<a\b[^>]*>[\s\S]*?<\/a>/g) ?? [];
  return { anchors };
};

describe("MemberTile", () => {
  it("has exactly one link — the name — stretched over the card, with only text inside", () => {
    const html = render({ stats: rated });
    const { anchors } = parse(html);
    expect(anchors).toHaveLength(1);
    const link = anchors[0] ?? "";
    expect(link).toContain('href="/members/hans"');
    expect(link).toContain('title="Hans-Peter van den Berg"');
    expect(link).toContain("after:inset-0");
    expect(link).not.toMatch(/<button|<a\b[\s\S]*<a\b/);
    expect(link.replace(/<[^>]+>/g, "")).toBe("Hans-Peter van den Berg");
  });

  it("does not nest the action buttons inside the link", () => {
    const html = render({ stats: rated });
    const linkEnd = html.indexOf("</a>");
    const firstButton = html.indexOf("<button");
    expect(firstButton).toBeGreaterThan(linkEnd);
    // Actions sit above the stretched-link overlay.
    expect(html).toMatch(/class="[^"]*relative z-10[^"]*"[^>]*><button/);
  });

  it("labels the icon actions with the member's name", () => {
    const html = render({ stats: rated });
    expect(html).toContain('aria-label="Unfollow Hans-Peter van den Berg"');
    expect(html).toContain('aria-label="Message Hans-Peter van den Berg"');
  });

  it("describes the link with the meta line and the stats", () => {
    const html = render({ stats: rated }, { followsYou: true });
    const describedBy = html.match(/aria-describedby="([^"]+)"/)?.[1];
    expect(describedBy?.split(" ")).toHaveLength(2);
    for (const id of describedBy!.split(" ")) {
      expect(html).toContain(`id="${id}"`);
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
    expect(
      html.match(/aria-describedby="([^"]+)"/)?.[1].split(" "),
    ).toHaveLength(1);
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
    const follow = html.match(
      /<button[^>]*aria-label="Follow Hans-Peter van den Berg"[^>]*>/,
    )?.[0];
    expect(follow).toContain("bg-primary");
    // Private stats and no meta line: nothing to describe the link with.
    expect(html).not.toContain("aria-describedby");
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
    const trigger = html.match(
      /<button[^>]*aria-label="Follow request to Hans-Peter van den Berg pending"[^>]*>/,
    )?.[0];
    expect(trigger).toContain('aria-haspopup="menu"');
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
    expect(html).toMatch(
      /data-slot="avatar"[^>]*aria-hidden="true"|aria-hidden="true"[^>]*data-slot="avatar"/,
    );
  });
});
