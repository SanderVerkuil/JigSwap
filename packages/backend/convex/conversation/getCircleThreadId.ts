import { ConversationApplicationError, toCircleId } from "@jigswap/domain";
import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { query } from "../_generated/server";
import { requireMember } from "../identity/requireMember";
import { toConvexError } from "./errors";
import { circleFloorOf, circleRowOf } from "./readModelHelpers";

// The circle page's chat preview: which thread to read, without creating one (only
// openCircleThread does that, when the member presses "Open group chat"). Members only: an
// unknown circle, a non-member and an ex-member all get the same CircleNotFound, as
// openCircleThread. Returns the thread's aggregateId only when the viewer may read it right now
// (a participant with a history floor, the same rule getThreadMessages applies), else null: no
// thread yet, or a fresh seat whose sync is still pending. The messages themselves come from
// getThreadMessages, so the joinedAt floor and the block flags are applied in one place.
export const getCircleThreadId = query({
  args: { circleId: v.string() },
  handler: async (ctx, args): Promise<string | null> => {
    const me = (await requireMember(ctx)) as unknown as Id<"users">;
    const circle = await circleRowOf(ctx, args.circleId);
    if (!circle || !circle.memberships.some((m) => m.memberId === me)) {
      throw toConvexError(
        ConversationApplicationError.circleNotFound(toCircleId(args.circleId)),
      );
    }
    const thread = await ctx.db
      .query("threads")
      .withIndex("by_circle", (q) => q.eq("circleId", args.circleId))
      .first();
    if (!thread || !thread.participants.includes(me)) return null;
    if ((await circleFloorOf(ctx, thread, me)) === null) return null;
    return thread.aggregateId;
  },
});
