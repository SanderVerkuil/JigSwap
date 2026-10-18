import type {
  CircleDetailView,
  CircleMemberView,
  CircleSummaryView,
} from "@jigswap/contracts";
import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { projectMemberIdentity } from "../social/privacy";

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
  // Callers only map circles the viewer belongs to; the owner's seat is always Admin.
  viewerPermission:
    row.ownerId === viewerId
      ? "Admin"
      : (row.memberships.find((m) => m.memberId === viewerId)?.permission ??
        "ViewOnly"),
  createdAt: row.createdAt,
});

// A circle with its members resolved through the identity chokepoint. Each membership is joined to
// the member's projected identity; the owner's seat is flagged (permanent, implicitly Admin).
export const toCircleDetail = async (
  ctx: QueryCtx,
  row: Doc<"circles">,
  viewerId: Id<"users">,
): Promise<CircleDetailView> => {
  const members: CircleMemberView[] = await Promise.all(
    row.memberships.map(async (m) => {
      // Through the identity chokepoint (salt = the circle id): circle-mates are revealed by its
      // circle rule; a departed member is anonymous, so only the seat (id + departed) is surfaced.
      const projected = await projectMemberIdentity(
        ctx,
        viewerId,
        m.memberId,
        row._id,
      );
      const user = projected.anonymous ? null : projected.member;
      return {
        membershipId: m.id,
        memberId: m.memberId,
        name: user?.name,
        username: user?.username,
        avatar: user?.avatar,
        ...(projected.anonymous && projected.departed
          ? { departed: true }
          : {}),
        permission: m.permission,
        joinedAt: m.joinedAt,
        isOwner: m.memberId === row.ownerId,
      };
    }),
  );

  return { ...toCircleSummary(row, viewerId), members };
};
