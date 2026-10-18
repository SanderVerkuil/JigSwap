import {
  toMemberId,
  type CircleId,
  type CircleParticipant,
  type CircleRoster,
} from "@jigswap/domain";
import type { QueryCtx } from "../../_generated/server";

// Driven adapter for Conversation's CircleRoster port over Sharing's storage. The circle row's
// embedded `memberships` are the source of truth for who is in the circle AND when each joined
// (`joinedAt`, set when the seat was taken: an Admin's add or an accepted invite). The
// `circleMembers` junction mirrors the same set but carries no timestamp, so it can't supply the
// history floor; one indexed point read of the circle row gives both. No circle row = no circle.
export const convexCircleRoster = (ctx: QueryCtx): CircleRoster => ({
  async membersOf(
    circleId: CircleId,
  ): Promise<readonly CircleParticipant[] | null> {
    const row = await ctx.db
      .query("circles")
      .withIndex("by_aggregate_id", (q) =>
        q.eq("aggregateId", circleId as string),
      )
      .unique();
    if (!row) return null;
    return row.memberships.map((m) => ({
      memberId: toMemberId(m.memberId as string),
      joinedAt: new Date(m.joinedAt),
    }));
  },
});
