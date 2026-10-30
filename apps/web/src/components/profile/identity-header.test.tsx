// @vitest-environment happy-dom
import { gateway, type Id } from "@/gateway";
import { convexQuery, ConvexQueryClient } from "@convex-dev/react-query";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { ConvexReactClient } from "convex/react";
import { IntlProvider } from "use-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import en from "../../../locales/en.json";
import { IdentityHeader } from "./identity-header";
import type { Member } from "./member-view";

vi.mock("@/compat/clerk", () => ({
  useUser: () => ({ user: { imageUrl: undefined } }),
}));

const member: Member = {
  _id: "member_henk",
  _creationTime: 0,
  clerkId: "user_henk",
  name: "Henk Pieterszoon",
  isActive: true,
  createdAt: Date.UTC(2026, 0, 1),
  updatedAt: Date.UTC(2026, 0, 1),
};

const renderHeader = () => {
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
  });
  render(
    <QueryClientProvider client={queryClient}>
      <IntlProvider locale="en" messages={en} timeZone="Europe/Amsterdam">
        <IdentityHeader
          member={member}
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
