import {
  type Follow,
  type FollowRepository,
  type MemberId,
  toMemberId,
} from "@jigswap/domain";
import type { Id } from "../../_generated/dataModel";
import type { MutationCtx } from "../../_generated/server";
import { followToDomain, followToRow } from "./mappers";

// Driven adapter for the FollowRepository port over `ctx.db`. The only place the `follows` table
// is read/written for the domain path; the mapper is the ACL.
export const convexFollowRepository = (ctx: MutationCtx): FollowRepository => ({
  async find(
    followerId: MemberId,
    followeeId: MemberId,
  ): Promise<Follow | null> {
    const row = await ctx.db
      .query("follows")
      .withIndex("by_follower", (q) =>
        q.eq("followerId", followerId as unknown as Id<"users">),
      )
      .filter((q) =>
        q.eq(q.field("followeeId"), followeeId as unknown as Id<"users">),
      )
      .unique();
    return row ? followToDomain(row) : null;
  },

  async save(follow: Follow): Promise<void> {
    const row = followToRow(follow);
    const existing = await ctx.db
      .query("follows")
      .withIndex("by_aggregate_id", (q) => q.eq("aggregateId", row.aggregateId))
      .unique();
    if (existing) await ctx.db.patch(existing._id, row);
    else await ctx.db.insert("follows", row);
  },

  async remove(follow: Follow): Promise<void> {
    const existing = await ctx.db
      .query("follows")
      .withIndex("by_aggregate_id", (q) =>
        q.eq("aggregateId", follow.id as string),
      )
      .unique();
    if (existing) await ctx.db.delete(existing._id);
  },

  async listFollowees(memberId: MemberId): Promise<readonly MemberId[]> {
    const rows = await ctx.db
      .query("follows")
      .withIndex("by_follower", (q) =>
        q.eq("followerId", memberId as unknown as Id<"users">),
      )
      .collect();
    return rows.map((r) => toMemberId(r.followeeId));
  },
});
