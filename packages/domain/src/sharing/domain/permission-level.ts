// What a member is allowed to do within a Circle. A literal union (not a class) because it is a
// plain enumerated capability the boundary passes as a primitive. `ViewOnly` may see circle
// content; `Exchange` may additionally transact within the circle; `Admin` may additionally
// manage membership and permissions. The owner is implicitly `Admin`.
export type PermissionLevel = "ViewOnly" | "Exchange" | "Admin";

// Ordering used for capability checks: a higher rank subsumes the lower ones.
const RANK: Readonly<Record<PermissionLevel, number>> = {
  ViewOnly: 0,
  Exchange: 1,
  Admin: 2,
};

// Admin is the only level that may manage membership/permissions (owner is implicitly Admin).
export const canManageMembers = (level: PermissionLevel): boolean =>
  level === "Admin";

// Exchange and Admin may transact within the circle; ViewOnly may not.
export const canExchangeWithin = (level: PermissionLevel): boolean =>
  RANK[level] >= RANK.Exchange;
