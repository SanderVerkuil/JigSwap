import {
  type HouseholdId,
  HouseholdInvite,
  type HouseholdInviteId,
  type HouseholdInviteRepository,
  type MemberId,
  toHouseholdId,
  toHouseholdInviteId,
  toMemberId,
} from "@jigswap/domain";
import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx } from "../../_generated/server";

const toDomain = (row: Doc<"householdInvites">): HouseholdInvite =>
  HouseholdInvite.rehydrate({
    id: toHouseholdInviteId(row.aggregateId),
    householdId: toHouseholdId(row.householdId),
    inviterId: toMemberId(row.inviterId),
    inviteeId: toMemberId(row.inviteeId),
    status: row.status,
    createdAt: new Date(row.createdAt),
    respondedAt:
      row.respondedAt === undefined ? undefined : new Date(row.respondedAt),
  });

// Driven adapter for HouseholdInviteRepository over `householdInvites`.
export const convexHouseholdInviteRepository = (
  ctx: MutationCtx,
): HouseholdInviteRepository => {
  const rowById = (
    id: HouseholdInviteId,
  ): Promise<Doc<"householdInvites"> | null> =>
    ctx.db
      .query("householdInvites")
      .withIndex("by_aggregate_id", (q) => q.eq("aggregateId", id as string))
      .unique();

  return {
    async findById(id) {
      const row = await rowById(id);
      return row ? toDomain(row) : null;
    },

    async findPending(householdId: HouseholdId, inviteeId: MemberId) {
      const rows = await ctx.db
        .query("householdInvites")
        .withIndex("by_invitee_status", (q) =>
          q
            .eq("inviteeId", inviteeId as unknown as Id<"users">)
            .eq("status", "pending"),
        )
        .collect();
      const row = rows.find((r) => r.householdId === (householdId as string));
      return row ? toDomain(row) : null;
    },

    async save(invite: HouseholdInvite) {
      const state = invite.toState();
      const row = {
        aggregateId: state.id as string,
        householdId: state.householdId as string,
        inviterId: state.inviterId as unknown as Id<"users">,
        inviteeId: state.inviteeId as unknown as Id<"users">,
        status: state.status,
        createdAt: state.createdAt.getTime(),
        respondedAt: state.respondedAt?.getTime(),
      };
      const existing = await rowById(state.id);
      if (existing) await ctx.db.patch(existing._id, row);
      else await ctx.db.insert("householdInvites", row);
    },

    async removePendingForHousehold(householdId: HouseholdId) {
      const rows = await ctx.db
        .query("householdInvites")
        .withIndex("by_household", (q) =>
          q.eq("householdId", householdId as string),
        )
        .collect();
      for (const row of rows) {
        if (row.status === "pending") await ctx.db.delete(row._id);
      }
    },
  };
};
