import type {
  CircleDetailView,
  CircleMemberView,
  CircleSummaryView,
} from "@jigswap/contracts";
import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { projectCircleMember } from "../conversation/threadMemberProjection";

// Shared row->DTO mapping for the Sharing reads, so every sharing adapter emits typed view DTOs
// (faithful supersets of the joined rows) rather than leaking raw documents.

// A circle as a list summary (no member join). `viewerId` is the signed-in member's _id.
export const toCircleSummary = (
  row: Doc<"circles">,
  viewerId: Id<"users">,
): CircleSummaryView => ({
  _id: row._id,
  aggregateId: row.aggregateId,
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
// `circleId` is the aggregateId the row was looked up by.
export const toCircleDetail = async (
  ctx: QueryCtx,
  row: Doc<"circles">,
  circleId: string,
  viewerId: Id<"users">,
): Promise<CircleDetailView> => {
  const members: CircleMemberView[] = await Promise.all(
    row.memberships.map(async (m) => {
      // As the circle chat projects them (salt = the circle id): circle-mates are revealed by the
      // circle rule even when they blocked the viewer, so the list can't give a block away; a
      // departed member is anonymous, so only the seat (membershipId + departed) is surfaced: no
      // user _id, which would tie the anonymous seat back to the account.
      const projected = await projectCircleMember(
        ctx,
        viewerId,
        m.memberId,
        circleId,
        row._id,
      );
      const user = projected.anonymous ? null : projected.member;
      const departed = projected.anonymous && projected.departed === true;
      return {
        membershipId: m.id,
        ...(departed ? {} : { memberId: m.memberId }),
        name: user?.name,
        username: user?.username,
        avatar: user?.avatar,
        ...(departed ? { departed: true } : {}),
        permission: m.permission,
        joinedAt: m.joinedAt,
        isOwner: m.memberId === row.ownerId,
      };
    }),
  );

  return { ...toCircleSummary(row, viewerId), members };
};
