// @vitest-environment happy-dom
import { gateway, type Id } from "@/gateway";
import { convexQuery, ConvexQueryClient } from "@convex-dev/react-query";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { ConvexReactClient } from "convex/react";
import type { ReactNode } from "react";
import { IntlProvider } from "use-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import en from "../../../locales/en.json";
import { IdentityHeader } from "./identity-header";
import type { Member } from "./member-view";

vi.mock("@/compat/clerk", () => ({
  useUser: () => ({ user: { imageUrl: undefined } }),
}));

// Router-free links: the test asserts the rendered href, not routing.
vi.mock("@tanstack/react-router", () => ({
  Link: ({
    to,
    params,
    hash,
    children,
    ...rest
  }: {
    to: string;
    params?: Record<string, string>;
    hash?: string;
    children?: ReactNode;
  }) => (
    <a
      href={`${Object.entries(params ?? {}).reduce(
        (path, [key, value]) => path.replace(`$${key}`, value),
        to,
      )}${hash ? `#${hash}` : ""}`}
      {...rest}
    >
      {children}
    </a>
  ),
}));

const member: Member = {
  _id: "member_henk",
  handle: "member_henk",
  _creationTime: 0,
  clerkId: "user_henk",
  name: "Henk Pieterszoon",
  isActive: true,
  createdAt: Date.UTC(2026, 0, 1),
  updatedAt: Date.UTC(2026, 0, 1),
};

const renderHeader = ({
  memberOverrides = {},
  profile = {},
}: {
  memberOverrides?: Partial<Member>;
  profile?: { visibility?: "public" | "private"; displayName?: string };
} = {}) => {
  const convexQueryClient = new ConvexQueryClient(
    new ConvexReactClient("https://example.convex.cloud"),
  );
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        queryKeyHashFn: convexQueryClient.hashFn(),
        staleTime: Infinity,
        retry: false,
        queryFn: () => new Promise<never>(() => {}),
      },
    },
  });
  queryClient.setQueryData(
    convexQuery(gateway.reputation.profile, {
      memberId: member._id as Id<"users">,
    }).queryKey,
    {
      memberId: member._id,
      ratingSum: 9,
      reviewCount: 2,
      averageRating: 4.5,
      credibility: 0,
      updatedAt: 0,
    },
  );
  queryClient.setQueryData(convexQuery(gateway.social.profile, {}).queryKey, {
    _id: "profile_henk",
    _creationTime: 0,
    memberId: member._id,
    visibility: "public",
    updatedAt: 0,
    ...profile,
  });
  render(
    <QueryClientProvider client={queryClient}>
      <IntlProvider locale="en" messages={en} timeZone="Europe/Amsterdam">
        <IdentityHeader
          member={{ ...member, ...memberOverrides }}
          isEditing={false}
          onToggleEdit={() => {}}
        />
      </IntlProvider>
    </QueryClientProvider>,
  );
};

afterEach(cleanup);

// happy-dom has no layout engine, so these pin the class contract that keeps a
// long name clear of the Edit Profile button on a phone; the geometry itself
// was checked in a browser at 390px and 820px.
describe("IdentityHeader on a phone", () => {
  it("gives the name column a real basis so the row wraps instead of squeezing it", () => {
    renderHeader();
    const column = screen.getByRole("heading", {
      name: "Henk Pieterszoon",
    }).parentElement;
    expect(column?.classList).toContain("min-w-0");
    expect(column?.classList).toContain("basis-48");
  });

  it("wraps the name inside its column at a phone-sized step", () => {
    renderHeader();
    const name = screen.getByRole("heading", { name: "Henk Pieterszoon" });
    expect(name.classList).toContain("[overflow-wrap:anywhere]");
    expect(name.classList).toContain("text-2xl");
    expect(name.classList).toContain("sm:text-3xl");
  });

  it("puts the badge and Edit Profile on their own row below sm", () => {
    renderHeader();
    const actions = screen.getByRole("button", {
      name: "Edit Profile",
    }).parentElement;
    expect(actions?.textContent).toContain("4.5");
    expect(actions?.classList).toContain("flex-wrap");
    expect(actions?.classList).toContain("basis-full");
    expect(actions?.classList).toContain("sm:basis-auto");
  });
});

// Your own profile says who can see it and how others see you (UX-120).
describe("IdentityHeader visibility and public view", () => {
  it("shows a public profile as findable, linking to the Privacy section", () => {
    renderHeader();
    const badge = screen.getByRole("link", { name: "Public · findable" });
    expect(badge.getAttribute("href")).toBe("/profile#privacy");
  });

  it("shows a private profile as Private, linking to the Privacy section", () => {
    renderHeader({ profile: { visibility: "private" } });
    const badge = screen.getByRole("link", { name: "Private" });
    expect(badge.getAttribute("href")).toBe("/profile#privacy");
    expect(
      screen.queryByRole("link", { name: "Public · findable" }),
    ).toBeNull();
  });

  it("links to the public profile by the server's handle, never a username it rebuilt (SEC-07)", () => {
    const href = () =>
      screen
        .getByRole("link", { name: "View public profile" })
        .getAttribute("href");

    renderHeader({ memberOverrides: { handle: "henk", username: "henk" } });
    expect(href()).toBe("/members/henk");
    cleanup();
    // Another member holds "henk" as a slug, so the server's handle is the id, not the username.
    renderHeader({ memberOverrides: { username: "henk" } });
    expect(href()).toBe("/members/member_henk");
    cleanup();
    // A backend that predates `handle`: the slug always resolves back to this member.
    renderHeader({
      memberOverrides: { handle: undefined, slug: "henk-p", username: "henk" },
    });
    expect(href()).toBe("/members/henk-p");
    cleanup();
    renderHeader({ memberOverrides: { handle: undefined, username: "henk" } });
    expect(href()).toBe("/members/member_henk");
  });

  it("names the member the way other members see them", () => {
    renderHeader({ profile: { displayName: "Puzzelhenk" } });
    expect(screen.getByRole("heading", { name: "Puzzelhenk" })).toBeTruthy();
  });
});

// The rating badge reads the way /members shows it, not "{rating} Trust"
// (UX-181).
describe("IdentityHeader rating badge", () => {
  it("shows the rating and review count like the public profile", () => {
    renderHeader();
    expect(screen.getByText("4.5 · 2 reviews")).toBeTruthy();
    expect(screen.queryByText(/Trust/)).toBeNull();
  });
});
