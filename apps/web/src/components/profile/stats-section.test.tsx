// @vitest-environment happy-dom
import { gateway } from "@/gateway";
import { convexQuery, ConvexQueryClient } from "@convex-dev/react-query";
import type { PublicProfileView } from "@jigswap/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { ConvexReactClient } from "convex/react";
import { IntlProvider } from "use-intl";
import { afterEach, describe, expect, it } from "vitest";
import en from "../../../locales/en.json";
import type { Member } from "./member-view";
import { ProfileStatsSection } from "./stats-section";

const member: Member = {
  _id: "member_henk",
  _creationTime: 0,
  clerkId: "user_henk",
  name: "Henk Pieterszoon",
  isActive: true,
  createdAt: Date.UTC(2026, 0, 1),
  updatedAt: Date.UTC(2026, 0, 1),
};

const unlocked = (
  stats: Partial<Extract<PublicProfileView, { locked: false }>["stats"]> = {},
): PublicProfileView => ({
  locked: false,
  hero: {
    memberId: member._id,
    displayName: member.name,
    memberSince: member.createdAt,
    rating: 0,
    reviewCount: 0,
    followerCount: 0,
    followingCount: 0,
    visibility: "public",
  },
  stats: {
    puzzlesOwned: 12,
    completions: 7,
    piecesPlaced: 6500,
    swaps: 3,
    ...stats,
  },
  records: { fastest: null, hardest: null },
  libraryScope: "all",
});

const renderStats = (profile: PublicProfileView | null) => {
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
    convexQuery(gateway.social.publicProfile, { handle: member._id }).queryKey,
    profile,
  );
  render(
    <QueryClientProvider client={queryClient}>
      <IntlProvider locale="en" messages={en} timeZone="Europe/Amsterdam">
        <ProfileStatsSection member={member} />
      </IntlProvider>
    </QueryClientProvider>,
  );
};

afterEach(cleanup);

// /profile shows the same four numbers visitors see on /members/<handle>
// (UX-120), read from the same query.
describe("ProfileStatsSection", () => {
  it("shows the public profile's four stats with the /members labels", () => {
    renderStats(unlocked());
    const cell = (label: string) =>
      screen.getByText(label).parentElement?.textContent;
    expect(cell("puzzles owned")).toBe("12puzzles owned");
    expect(cell("completions")).toBe("7completions");
    expect(cell("pieces placed")).toBe("6,500pieces placed");
    expect(cell("swaps")).toBe("3swaps");
  });

  it("drops the stats visitors never see", () => {
    renderStats(unlocked());
    expect(screen.getByText("swaps")).toBeTruthy();
    expect(screen.queryByText("Average Rating")).toBeNull();
    expect(screen.queryByText("Available Puzzles")).toBeNull();
  });

  it("renders nothing when the profile can't be read", () => {
    renderStats(null);
    expect(screen.queryByText("puzzles owned")).toBeNull();
  });
});

// The trust meter is a labelled progressbar whose copy matches the rule it
// applies: completed exchanges only, thresholds 5 and 10 (UX-121).
describe("ProfileStatsSection trust level", () => {
  it("is a progressbar named Trust Level with the count as its value", () => {
    renderStats(unlocked({ swaps: 3 }));
    const meter = screen.getByRole("progressbar", { name: "Trust Level" });
    expect(meter.getAttribute("aria-valuemin")).toBe("0");
    expect(meter.getAttribute("aria-valuemax")).toBe("10");
    expect(meter.getAttribute("aria-valuenow")).toBe("3");
    expect(meter.getAttribute("aria-valuetext")).toBe(
      "Beginner, 3 completed exchanges",
    );
  });

  it("says what it is based on and how far the next level is", () => {
    renderStats(unlocked({ swaps: 3 }));
    expect(
      screen.getByText("Based on completed exchanges · 2 more to Intermediate"),
    ).toBeTruthy();
    expect(screen.queryByText(/reviews/)).toBeNull();
  });

  it("counts towards Experienced from Intermediate", () => {
    renderStats(unlocked({ swaps: 9 }));
    expect(
      screen.getByText("Based on completed exchanges · 1 more to Experienced"),
    ).toBeTruthy();
  });

  it("caps the meter at the top level and drops the next-level hint", () => {
    renderStats(unlocked({ swaps: 14 }));
    const meter = screen.getByRole("progressbar", { name: "Trust Level" });
    expect(meter.getAttribute("aria-valuenow")).toBe("10");
    expect(meter.getAttribute("aria-valuetext")).toBe(
      "Experienced, 14 completed exchanges",
    );
    expect(screen.getByText("Based on completed exchanges")).toBeTruthy();
  });
});
