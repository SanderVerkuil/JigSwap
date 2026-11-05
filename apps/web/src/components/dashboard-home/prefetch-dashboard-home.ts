import { gateway, type Id } from "@/gateway";
import { convexQuery } from "@convex-dev/react-query";
import type { QueryClient } from "@tanstack/react-query";
import { IN_MOTION_ROWS, LATEST_FEED_SIZE, latestRows } from "./pulse-section";
import { MY_SHELF_SIZE } from "./shelf-section";

// The dashboard home's reads during SSR, with the very arguments its sections ask for, so they find
// them in the query cache on the first render. A read that fails here is left to the browser.
export async function prefetchDashboardHome(
  queryClient: QueryClient,
): Promise<void> {
  const myMember = async () => {
    const me = await queryClient.fetchQuery(
      convexQuery(gateway.identity.currentUser, {}),
    );
    if (!me) return;
    const feed = await queryClient.fetchQuery(
      convexQuery(gateway.social.activityFeed, { limit: LATEST_FEED_SIZE }),
    );
    // Each row the Latest column shows names its member. The feed holds more rows than that, and a
    // read made here stays subscribed in the browser after hydration, whether a row uses it or not.
    const others = new Set(latestRows(feed).map((entry) => entry.memberId));
    others.delete(me._id);
    await Promise.allSettled([
      queryClient.fetchQuery(
        convexQuery(gateway.identity.userStats, {
          userId: me._id as Id<"users">,
        }),
      ),
      ...[...others].map((userId) =>
        queryClient.fetchQuery(
          convexQuery(gateway.identity.byId, {
            userId: userId as Id<"users">,
          }),
        ),
      ),
    ]);
  };
  const inMotion = async () => {
    const live = await queryClient.fetchQuery(
      convexQuery(gateway.exchange.myLive, {}),
    );
    // In Motion tops up with finished exchanges when fewer are in play.
    if (live.length < IN_MOTION_ROWS) {
      await queryClient.fetchQuery(
        convexQuery(gateway.exchange.myHistory, {
          paginationOpts: { numItems: IN_MOTION_ROWS, cursor: null },
        }),
      );
    }
  };

  await Promise.allSettled([
    myMember(),
    inMotion(),
    queryClient.fetchQuery(
      convexQuery(gateway.library.myShelf, { limit: MY_SHELF_SIZE }),
    ),
    queryClient.fetchQuery(convexQuery(gateway.solving.myGoals, {})),
    queryClient.fetchQuery(convexQuery(gateway.solving.myInProgress, {})),
    queryClient.fetchQuery(convexQuery(gateway.onboarding.quickStart, {})),
    queryClient.fetchQuery(convexQuery(gateway.social.connectionOffers, {})),
    // The Fresh cards mark box art still being checked.
    queryClient.fetchQuery(
      convexQuery(gateway.catalog.listMyBoxArtInCheck, {}),
    ),
  ]);
}
