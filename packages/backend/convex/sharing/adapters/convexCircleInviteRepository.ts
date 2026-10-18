import {
  CircleInvite,
  toCircleId,
  toCircleInviteId,
  toMemberId,
  type CircleId,
  type CircleInviteId,
  type CircleInviteRepository,
  type MemberId,
} from "@jigswap/domain";
import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx } from "../../_generated/server";

// ACL: `circleInvites` row -> CircleInvite aggregate.
export const toCircleInvite = (row: Doc<"circleInvites">): CircleInvite =>
  CircleInvite.rehydrate({
    id: toCircleInviteId(row.aggregateId),
    circleId: toCircleId(row.circleAggregateId),
    inviterId: toMemberId(row.inviterId),
    inviteeId: toMemberId(row.inviteeId),
    permission: row.permission,
    status: row.status,
    createdAt: new Date(row.createdAt),
    expiresAt: new Date(row.expiresAt),
    ...(row.decidedAt === undefined
      ? {}
      : { decidedAt: new Date(row.decidedAt) }),
  });

// Driven adapter for CircleInviteRepository over `circleInvites`.
export const convexCircleInviteRepository = (
  ctx: MutationCtx,
): CircleInviteRepository => {
  const rowById = (id: CircleInviteId) =>
    ctx.db
      .query("circleInvites")
      .withIndex("by_aggregate_id", (q) => q.eq("aggregateId", id as string))
      .unique();

  return {
    async findById(id) {
      const row = await rowById(id);
      return row ? toCircleInvite(row) : null;
    },

    async findPending(circleId: CircleId, inviteeId: MemberId) {
      const rows = await ctx.db
        .query("circleInvites")
        .withIndex("by_circle_invitee", (q) =>
          q
            .eq("circleAggregateId", circleId as string)
            .eq("inviteeId", inviteeId as unknown as Id<"users">),
        )
        .collect();
      const row = rows.find((r) => r.status === "pending");
      return row ? toCircleInvite(row) : null;
    },

    async listPendingForCircle(circleId: CircleId) {
      const rows = await ctx.db
        .query("circleInvites")
        .withIndex("by_circle_status", (q) =>
          q.eq("circleAggregateId", circleId as string).eq("status", "pending"),
        )
        .collect();
      return rows.map(toCircleInvite);
    },

    async save(invite: CircleInvite) {
      const state = invite.toState();
      const row = {
        aggregateId: state.id as string,
        circleAggregateId: state.circleId as string,
        inviteeId: state.inviteeId as unknown as Id<"users">,
        inviterId: state.inviterId as unknown as Id<"users">,
        permission: state.permission,
        status: state.status,
        createdAt: state.createdAt.getTime(),
        expiresAt: state.expiresAt.getTime(),
        ...(state.decidedAt === undefined
          ? {}
          : { decidedAt: state.decidedAt.getTime() }),
      };
      const existing = await rowById(state.id);
      if (existing) await ctx.db.patch(existing._id, row);
      else await ctx.db.insert("circleInvites", row);
    },
  };
};
