import type { FollowEdgeView, ProfileView } from "@jigswap/contracts";
import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";

// Shared row->DTO mapping for the Social reads, so every adapter emits typed view DTOs rather than
// leaking raw documents.

export const toProfileView = (row: Doc<"profiles">): ProfileView => ({
  _id: row._id,
  _creationTime: row._creationTime,
  aggregateId: row.aggregateId,
  memberId: row.memberId,
  displayName: row.displayName,
  bio: row.bio,
  visibility: row.visibility ?? "public",
  updatedAt: row.updatedAt,
});

// Build the followers/following list entry for one edge from the COUNTERPARTY member's id. Prefers
// the counterparty's own Social profile display name, falling back to their account name so a
// member without a profile still renders.
export const toFollowEdgeView = async (
  ctx: QueryCtx,
  followId: string | undefined,
  memberId: Id<"users">,
  createdAt: number,
): Promise<FollowEdgeView> => {
  const [profile, user] = await Promise.all([
    ctx.db
      .query("profiles")
      .withIndex("by_member", (q) => q.eq("memberId", memberId))
      .unique(),
    ctx.db.get(memberId),
  ]);
  return {
    followId,
    memberId,
    displayName: profile?.displayName ?? user?.name ?? "Member",
    createdAt,
  };
};
