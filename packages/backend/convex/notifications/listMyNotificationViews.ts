import type { NotificationView } from "@jigswap/contracts";
import { paginationOptsValidator, type PaginationResult } from "convex/server";
import type { Id } from "../_generated/dataModel";
import { query } from "../_generated/server";
import { isAdmin } from "../identity/isAdmin";
import { requireMember } from "../identity/requireMember";
import {
  createNotificationViewCache,
  resolveNotificationView,
} from "./resolveNotificationView";

/** Hard cap on a page, whatever the client asks for (the web requests 30). */
export const MAX_NOTIFICATION_PAGE_SIZE = 100;

// Read side: the caller's in-app notifications as resolved views, newest first, paginated.
// Auth-gated and scoped to the acting member. Actor identity, live context, the deep link and the
// inline actions are all resolved server-side per read (resolveNotificationView). Admin-type rows
// are dropped for a viewer who is no longer an admin, so a page can hold fewer than numItems.
export const listMyNotificationViews = query({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, args): Promise<PaginationResult<NotificationView>> => {
    const memberId = await requireMember(ctx);
    const viewerId = memberId as unknown as Id<"users">;
    const result = await ctx.db
      .query("notifications")
      .withIndex("by_user", (q) => q.eq("userId", viewerId))
      .order("desc")
      // Only the in-app feed: legacy rows without a channel are in-app (see the row mapper).
      .filter((q) =>
        q.or(
          q.eq(q.field("channel"), "inApp"),
          q.eq(q.field("channel"), undefined),
        ),
      )
      .paginate({
        ...args.paginationOpts,
        numItems: Math.max(
          1,
          Math.min(args.paginationOpts.numItems, MAX_NOTIFICATION_PAGE_SIZE),
        ),
      });

    const cache = createNotificationViewCache({
      viewerIsAdmin: await isAdmin(ctx),
    });
    const views = await Promise.all(
      result.page.map((row) =>
        resolveNotificationView(ctx, viewerId, row, cache),
      ),
    );
    return {
      ...result,
      page: views.filter((view): view is NotificationView => view !== null),
    };
  },
});
