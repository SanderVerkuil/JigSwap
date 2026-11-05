import { HOUSEHOLD_INVITE_TTL_MS } from "@jigswap/domain";
import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { isBlockedEitherWay } from "../social/blocks";

// Read-side helpers over `householdMembers` shared by the household queries and the copy-access
// gate. Kept tiny: membership is the only fact the read side needs.

export const membershipOf = (
  ctx: QueryCtx,
  memberId: Id<"users">,
): Promise<Doc<"householdMembers"> | null> =>
  ctx.db
    .query("householdMembers")
    .withIndex("by_member", (q) => q.eq("memberId", memberId))
    .first();

export const membersOfHousehold = (
  ctx: QueryCtx,
  householdId: string,
): Promise<Doc<"householdMembers">[]> =>
  ctx.db
    .query("householdMembers")
    .withIndex("by_household", (q) => q.eq("householdId", householdId))
    .collect();

// The household-wide default copy permission of a household (undefined when unset). Feed it to the
// domain's resolveHouseholdCopyPermission; never fall back here.
export const householdDefaultOf = async (
  ctx: QueryCtx,
  householdId: string,
): Promise<Doc<"households">["defaultCopyPermission"]> => {
  const row = await ctx.db
    .query("households")
    .withIndex("by_aggregate_id", (q) => q.eq("aggregateId", householdId))
    .unique();
  return row?.defaultCopyPermission;
};

// The OTHER members of the member's household (empty when they are in none).
export const householdMateIds = async (
  ctx: QueryCtx,
  memberId: Id<"users">,
): Promise<Set<Id<"users">>> => {
  const membership = await membershipOf(ctx, memberId);
  if (!membership) return new Set();
  const members = await membersOfHousehold(ctx, membership.householdId);
  return new Set(
    members.map((m) => m.memberId).filter((id) => id !== memberId),
  );
};

// Whether a pending household invite can still be accepted, as acceptHouseholdInvite decides: not
// lapsed (HOUSEHOLD_INVITE_TTL_MS after it was sent, the domain's HouseholdInvite.isExpired), its
// inviter still the household's admin (an invite speaks for the household only while the admin who
// sent it runs it), and no block either way between inviter and invitee. Every read of pending
// invites hides the rest, so nobody is shown an invite that no longer works, and a refused Accept
// can't single out a block (spec 2.6).
export const isOpenHouseholdInvite = async (
  ctx: QueryCtx,
  invite: Pick<
    Doc<"householdInvites">,
    "status" | "createdAt" | "householdId" | "inviterId" | "inviteeId"
  >,
  now: number,
): Promise<boolean> => {
  if (invite.status !== "pending") return false;
  if (now >= invite.createdAt + HOUSEHOLD_INVITE_TTL_MS) return false;
  const inviter = await membershipOf(ctx, invite.inviterId);
  if (inviter?.householdId !== invite.householdId || inviter.role !== "admin") {
    return false;
  }
  return !(await isBlockedEitherWay(ctx, invite.inviterId, invite.inviteeId));
};
