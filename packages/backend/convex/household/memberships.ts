import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";

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
