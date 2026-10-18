import { SharingApplicationError, toCircleId } from "@jigswap/domain";
import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { toCircleInvite } from "./adapters/convexCircleInviteRepository";
import { toConvexError } from "./errors";

/** The circle row by its domain CircleId, or null. */
export const circleByAggregateId = (ctx: QueryCtx, circleId: string) =>
  ctx.db
    .query("circles")
    .withIndex("by_aggregate_id", (q) => q.eq("aggregateId", circleId))
    .unique();

/** Whether `memberId` holds an Admin seat in the circle (the owner's seat is always Admin). */
export const isCircleAdmin = (
  row: Doc<"circles">,
  memberId: Id<"users">,
): boolean =>
  row.memberships.some(
    (m) => m.memberId === memberId && m.permission === "Admin",
  );

/**
 * The circle, for one of its Admins. Anyone else (a plain member, a non-member, an unknown id)
 * gets CircleNotFound, so Admin-only reads can't be used to probe which circles exist.
 */
export const requireCircleAdmin = async (
  ctx: QueryCtx,
  circleId: string,
  viewerId: Id<"users">,
): Promise<Doc<"circles">> => {
  const row = await circleByAggregateId(ctx, circleId);
  if (!row || !isCircleAdmin(row, viewerId)) {
    throw toConvexError(
      SharingApplicationError.circleNotFound(toCircleId(circleId)),
    );
  }
  return row;
};

/** The circle's pending invites that are still open (not past expiresAt) at `now`. */
export const openInvitesOf = async (
  ctx: QueryCtx,
  circleId: string,
  now: number,
): Promise<Doc<"circleInvites">[]> =>
  (
    await ctx.db
      .query("circleInvites")
      .withIndex("by_circle_status", (q) =>
        q.eq("circleAggregateId", circleId).eq("status", "pending"),
      )
      .collect()
  ).filter((invite) => invite.expiresAt > now);

/** Invitees of this circle still inside the re-invite cooldown (a recent decline or revoke). */
export const reinviteHeldOff = async (
  ctx: QueryCtx,
  circleId: string,
  now: number,
): Promise<Set<Id<"users">>> => {
  const held = new Set<Id<"users">>();
  for (const status of ["declined", "revoked"] as const) {
    const rows = await ctx.db
      .query("circleInvites")
      .withIndex("by_circle_status", (q) =>
        q.eq("circleAggregateId", circleId).eq("status", status),
      )
      .collect();
    for (const row of rows) {
      if (toCircleInvite(row).holdsOffReinviteAt(new Date(now))) {
        held.add(row.inviteeId);
      }
    }
  }
  return held;
};
