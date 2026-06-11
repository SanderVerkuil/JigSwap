import type {
  CircleDetailView,
  CircleMemberView,
  CircleSummaryView,
} from "@jigswap/contracts";
import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";

// Shared row->DTO mapping for the Sharing reads, so every sharing adapter emits typed view DTOs
// (faithful supersets of the joined rows) rather than leaking raw documents.

// A circle as a list summary (no member join). `viewerId` is the signed-in member's _id.
export const toCircleSummary = (
  row: Doc<"circles">,
  viewerId: Id<"users">,
): CircleSummaryView => ({
  _id: row._id,
  aggregateId: row.aggregateId,
  ownerId: row.ownerId,
  name: row.name,
  memberCount: row.memberships.length,
  isOwnedByViewer: row.ownerId === viewerId,
  createdAt: row.createdAt,
});

// A circle with its members resolved against `users`. Each membership is joined to the member's
// profile summary; the owner's seat is flagged (permanent, implicitly Admin).
export const toCircleDetail = async (
  ctx: QueryCtx,
  row: Doc<"circles">,
  viewerId: Id<"users">,
): Promise<CircleDetailView> => {
  const members: CircleMemberView[] = await Promise.all(
    row.memberships.map(async (m) => {
      const user = await ctx.db.get(m.memberId);
      return {
        membershipId: m.id,
        memberId: m.memberId,
        name: user?.name ?? "Unknown member",
        username: user?.username,
        avatar: user?.avatar,
        permission: m.permission,
        joinedAt: m.joinedAt,
        isOwner: m.memberId === row.ownerId,
      };
    }),
  );

  return { ...toCircleSummary(row, viewerId), members };
};
