// Friend Circles read-model view DTOs: the typed shapes the gateway's `sharing:` reads return,
// replacing raw Convex rows. Ids are surfaced as the opaque strings they are at runtime; the web
// app re-casts to its own `Id<...>` at the edge. Each is a faithful superset of exactly what the
// circles UI reads, so the contract stays the single source of truth for the read shape.

import type { DocId } from "../catalog/views";

// What a member is allowed to do within a circle (mirrors the domain PermissionLevel union).
export type CirclePermissionLevel = "ViewOnly" | "Exchange" | "Admin";

// A single member's seat in a circle, joined with their profile summary for display.
export interface CircleMemberView {
  // The domain MembershipId.
  membershipId: string;
  // The member's user _id (the resolved MemberId).
  memberId: DocId;
  name: string;
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
