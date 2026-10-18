// Friend Circles read-model view DTOs: the typed shapes the gateway's `sharing:` reads return,
// replacing raw Convex rows. Ids are surfaced as the opaque strings they are at runtime; the web
// app re-casts to its own `Id<...>` at the edge. Each is a faithful superset of exactly what the
// circles UI reads, so the contract stays the single source of truth for the read shape.

import type { DocId } from "../catalog/views";
import type { ProjectedMember } from "../social/social";

// What a member is allowed to do within a circle (mirrors the domain PermissionLevel union).
export type CirclePermissionLevel = "ViewOnly" | "Exchange" | "Admin";

// A single member's seat in a circle, joined with their profile summary for display.
export interface CircleMemberView {
  // The domain MembershipId.
  membershipId: string;
  // The member's user _id (the resolved MemberId).
  memberId: DocId;
  /** Raw account name; may be absent. Render via resolveMemberDisplayName / useMemberDisplayName. */
  name?: string;
  username?: string;
  avatar?: string;
  permission: CirclePermissionLevel;
  joinedAt: number;
  // True for the owner's permanent, implicitly-Admin seat (cannot be removed or re-permissioned).
  isOwner: boolean;
}

// A circle as it appears in the signed-in member's list: identity, name, owner, and a member count.
export interface CircleSummaryView {
  _id: DocId;
  // The domain CircleId; circle mutations take this aggregateId, not the Convex _id.
  aggregateId?: string;
  ownerId: DocId;
  name: string;
  memberCount: number;
  // Whether the signed-in viewer owns this circle (surfaces admin affordances in the UI).
  isOwnedByViewer: boolean;
  createdAt: number;
}

// A circle with its resolved members, returned by `sharing.getCircle`.
export interface CircleDetailView extends CircleSummaryView {
  members: CircleMemberView[];
}

// A pending, unexpired circle invite as its INVITEE sees it (`sharing.listMyCircleInvites`): what
// they are invited to and by whom, never the member list or the circle's shared copies.
export interface MyCircleInviteView {
  // The domain CircleInviteId (accept/decline take this).
  inviteId: string;
  circleName: string;
  memberCount: number;
  inviter: ProjectedMember;
  // The seat they would take on accepting.
  permission: CirclePermissionLevel;
  expiresAt: number;
}

// A pending, unexpired invite as the circle's Admins see it (`sharing.listCircleInvites`).
export interface CircleInviteView {
  inviteId: string;
  invitee: ProjectedMember;
  invitedBy: ProjectedMember;
  createdAt: number;
  expiresAt: number;
}

// A member the Admin may invite (`sharing.listInvitableMembers`): someone they may contact who is
// not yet in the circle and has no open invite. Only members whose identity the Admin may see are
// listed, so the projection is always the revealed variant (its `member._id` is what
// inviteToCircle takes).
export type InvitableMemberView = Extract<
  ProjectedMember,
  { anonymous: false }
>;
