import {
  type FollowRequest,
  type FollowRequestId,
  type FollowRequestRepository,
  type MemberId,
} from "@jigswap/domain";
import type { Id } from "../../_generated/dataModel";
import type { MutationCtx } from "../../_generated/server";
import { followRequestToDomain, followRequestToRow } from "./mappers";

// Driven adapter for the FollowRequestRepository port over `ctx.db`. The only place the
// `followRequests` table is read/written for the domain path; the mapper is the ACL.
export const convexFollowRequestRepository = (
  ctx: MutationCtx,
): FollowRequestRepository => ({
  async findByPair(
    requesterId: MemberId,
    targetId: MemberId,
  ): Promise<FollowRequest | null> {
    const row = await ctx.db
      .query("followRequests")
      .withIndex("by_requester_target", (q) =>
        q
          .eq("requesterId", requesterId as unknown as Id<"users">)
          .eq("targetId", targetId as unknown as Id<"users">),
      )
      .first();
    return row ? followRequestToDomain(row) : null;
  },

  async findById(id: FollowRequestId): Promise<FollowRequest | null> {
    const row = await ctx.db
      .query("followRequests")
      .withIndex("by_aggregate_id", (q) => q.eq("aggregateId", id as string))
      .unique();
    return row ? followRequestToDomain(row) : null;
  },

  async save(request: FollowRequest): Promise<void> {
    const row = followRequestToRow(request);
    const existing = await ctx.db
      .query("followRequests")
      .withIndex("by_aggregate_id", (q) => q.eq("aggregateId", row.aggregateId))
      .unique();
    if (existing) await ctx.db.patch(existing._id, row);
    else await ctx.db.insert("followRequests", row);
  },

  async remove(request: FollowRequest): Promise<void> {
    const existing = await ctx.db
      .query("followRequests")
      .withIndex("by_aggregate_id", (q) =>
        q.eq("aggregateId", request.id as string),
      )
      .unique();
    if (existing) await ctx.db.delete(existing._id);
  },
});
