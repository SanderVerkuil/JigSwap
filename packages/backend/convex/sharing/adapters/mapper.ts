import {
  Circle,
  type CircleState,
  type MemberId,
  type MembershipState,
  type PermissionLevel,
  toId,
} from "@jigswap/domain";
import type { Doc, Id } from "../../_generated/dataModel";

// ACL between the persisted `circles` row and the Circle aggregate (root + embedded memberships,
// saved as one unit). Schema changes stop here and never ripple into the domain.

// The insert/patch payload (the row minus Convex-managed `_id`/`_creationTime`).
export type CircleRow = Omit<Doc<"circles">, "_id" | "_creationTime">;

// Row -> aggregate. The row MUST carry an aggregateId (only domain-written rows do); the repository
// guards for it before mapping.
export const toDomain = (row: Doc<"circles">): Circle => {
  const memberships: MembershipState[] = row.memberships.map((m) => ({
    id: toId<"MembershipId">(m.id),
    memberId: toId<"MemberId">(m.memberId) as MemberId,
    permission: m.permission as PermissionLevel,
    joinedAt: new Date(m.joinedAt),
  }));

  const state: CircleState = {
    id: toId<"CircleId">(row.aggregateId as string),
    ownerId: toId<"MemberId">(row.ownerId) as MemberId,
    name: row.name,
    memberships,
    createdAt: new Date(row.createdAt),
  };
  return Circle.rehydrate(state);
};

// Aggregate -> row payload. Domain CircleId becomes `aggregateId`; the foreign member-id strings
// are re-branded to Convex user Ids for the columns. `memberIds` denormalizes for the by_member
// index.
export const toRow = (circle: Circle): CircleRow => {
  const state = circle.toState();
  const memberships = state.memberships.map((m) => ({
    id: m.id as string,
    memberId: m.memberId as unknown as Id<"users">,
    permission: m.permission,
    joinedAt: m.joinedAt.getTime(),
  }));
  return {
    aggregateId: state.id as string,
    ownerId: state.ownerId as unknown as Id<"users">,
    name: state.name,
    memberships,
    createdAt: state.createdAt.getTime(),
  };
};
