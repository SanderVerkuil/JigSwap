// @vitest-environment happy-dom
import { gateway, type Id } from "@/gateway";
import { convexQuery, ConvexQueryClient } from "@convex-dev/react-query";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { ConvexReactClient } from "convex/react";
import { IntlProvider } from "use-intl";
import { afterEach, describe, expect, it } from "vitest";
import en from "../../../locales/en.json";
import { ReputationSection } from "./reputation-section";

const memberId = "member_henk" as Id<"users">;

const renderSection = ({
  reviewCount,
  averageRating,
}: {
  reviewCount: number;
  averageRating: number;
}) => {
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
    convexQuery(gateway.reputation.profile, { memberId }).queryKey,
    {
      memberId,
      ratingSum: averageRating * reviewCount,
      reviewCount,
      averageRating,
      credibility: 0.5,
      updatedAt: 0,
    },
  );
  queryClient.setQueryData(
    convexQuery(gateway.reputation.reviewsForMember, { memberId }).queryKey,
    [],
  );
  render(
    <QueryClientProvider client={queryClient}>
      <IntlProvider locale="en" messages={en} timeZone="Europe/Amsterdam">
        <ReputationSection memberId={memberId} />
      </IntlProvider>
    </QueryClientProvider>,
  );
};

afterEach(cleanup);

// An empty reputation reads as "not yet", not as a 0.0 score (UX-121).
describe("ReputationSection", () => {
  it("shows no score or stars without reviews, and says when they come", () => {
    renderSection({ reviewCount: 0, averageRating: 0 });
    expect(screen.queryByText("0.0")).toBeNull();
    expect(
      screen.getByText(
        "No reviews yet. Reviews appear after your first completed exchange.",
      ),
    ).toBeTruthy();
    // Said once, not again as the section meta.
    expect(screen.queryByText("No reviews")).toBeNull();
  });

  it("shows the score and review count once there are reviews", () => {
    renderSection({ reviewCount: 2, averageRating: 4.5 });
    expect(screen.getByText("4.5")).toBeTruthy();
    expect(screen.getByText("2 reviews")).toBeTruthy();
    expect(
      screen.queryByText(
        "No reviews yet. Reviews appear after your first completed exchange.",
      ),
    ).toBeNull();
  });
});
