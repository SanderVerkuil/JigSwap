import { SharingApplicationError, toCircleId } from "@jigswap/domain";
import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { mutation } from "../_generated/server";
import { requireMember } from "../identity/requireMember";
import { circleByAggregateId } from "./circleAccess";
import { circleIconRows } from "./circleIcons";
import { toConvexError } from "./errors";

// Close the "removed" notice of the viewer's own refused icon upload (sharing/circleIcons.ts). A
// member of the circle only (anyone else gets CircleNotFound); a no-op when there is no such
// notice.
export const dismissCircleIconNotice = mutation({
  args: { circleId: v.string() },
  handler: async (ctx, { circleId }): Promise<void> => {
    const me = (await requireMember(ctx)) as unknown as Id<"users">;
    const circle = await circleByAggregateId(ctx, circleId);
    if (!circle || !circle.memberships.some((m) => m.memberId === me)) {
      throw toConvexError(
        SharingApplicationError.circleNotFound(toCircleId(circleId)),
      );
    }
    const [newest] = await circleIconRows(ctx, circle.aggregateId ?? circleId);
    if (
      newest &&
      newest.uploaderId === me &&
      (newest.moderationStatus === "rejected" ||
        newest.moderationStatus === "quarantined") &&
      newest.noticeDismissedAt === undefined
    ) {
      await ctx.db.patch(newest._id, { noticeDismissedAt: Date.now() });
    }
  },
});
