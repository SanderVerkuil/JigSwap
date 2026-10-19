import {
  HouseholdJoinRequest,
  toHouseholdId,
  toHouseholdJoinRequestId,
  toMemberId,
  type HouseholdJoinRequestId,
  type HouseholdJoinRequestRepository,
  type MemberId,
} from "@jigswap/domain";
import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx } from "../../_generated/server";

export const joinRequestFromRow = (
  row: Doc<"householdJoinRequests">,
): HouseholdJoinRequest =>
  HouseholdJoinRequest.rehydrate({
    id: toHouseholdJoinRequestId(row.aggregateId),
    householdId: toHouseholdId(row.householdId),
    requesterId: toMemberId(row.requesterId),
    adminId: toMemberId(row.adminId),
    linkId: row.linkId,
    status: row.status,
    dropped: row.dropped,
    ...(row.leaveHouseholdId !== undefined &&
      row.leaveConsequence !== undefined && {
        leave: {
          householdId: toHouseholdId(row.leaveHouseholdId),
          consequence: row.leaveConsequence,
        },
      }),
    createdAt: new Date(row.createdAt),
    expiresAt: new Date(row.expiresAt),
    respondedAt:
      row.respondedAt === undefined ? undefined : new Date(row.respondedAt),
  });

// Driven adapter for HouseholdJoinRequestRepository over `householdJoinRequests`. The domain's
// opaque linkId is the inviteLinks `_id`.
export const convexHouseholdJoinRequestRepository = (
  ctx: MutationCtx,
): HouseholdJoinRequestRepository => {
  const rowById = (
    id: HouseholdJoinRequestId,
  ): Promise<Doc<"householdJoinRequests"> | null> =>
    ctx.db
      .query("householdJoinRequests")
      .withIndex("by_aggregate_id", (q) => q.eq("aggregateId", id as string))
      .unique();
  const requester = (id: MemberId) => id as unknown as Id<"users">;

  return {
    async findById(id) {
      const row = await rowById(id);
      return row ? joinRequestFromRow(row) : null;
    },

    async findByRequesterAndLink(requesterId, linkId) {
      const row = await ctx.db
        .query("householdJoinRequests")
        .withIndex("by_link_requester", (q) =>
          q
            .eq("linkId", linkId as Id<"inviteLinks">)
            .eq("requesterId", requester(requesterId)),
        )
        .first();
      return row ? joinRequestFromRow(row) : null;
    },

    async listWaitingByRequester(requesterId) {
      const rows = [];
      for (const status of ["pending", "declined"] as const) {
        rows.push(
          ...(await ctx.db
            .query("householdJoinRequests")
            .withIndex("by_requester", (q) =>
              q.eq("requesterId", requester(requesterId)).eq("status", status),
            )
            .collect()),
        );
      }
      return rows.map(joinRequestFromRow);
    },

    async save(request) {
      const state = request.toState();
      const row = {
        aggregateId: state.id as string,
        householdId: state.householdId as string,
        requesterId: requester(state.requesterId),
        adminId: requester(state.adminId),
        linkId: state.linkId as Id<"inviteLinks">,
        status: state.status,
        dropped: state.dropped,
        leaveHouseholdId: state.leave?.householdId as string | undefined,
        leaveConsequence: state.leave?.consequence,
        createdAt: state.createdAt.getTime(),
        expiresAt: state.expiresAt.getTime(),
        respondedAt: state.respondedAt?.getTime(),
      };
      const existing = await rowById(state.id);
      if (existing) await ctx.db.patch(existing._id, row);
      else await ctx.db.insert("householdJoinRequests", row);
    },
  };
};
