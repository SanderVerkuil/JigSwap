import { CircleId, MemberId } from "./ids";
import {
  isPubliclyViewable,
  permitsTransaction,
  TransactionKind,
  VisibilityScope,
} from "./visibility-scope";

// VisibilityPolicy: the pure, circle-aware decision that unifies the 6-level model. It is a DOMAIN
// SERVICE — it loads nothing. The caller resolves the relevant circle-membership facts (which
// circles the viewer and owner BOTH belong to) and passes them in as `sharedCircles`, so the
// policy stays a total function of its inputs and free of I/O. The two questions it answers:
//
//   canView      — may `viewer` see content owned by `ownerId` at the given `scope`?
//   canTransact  — may `viewer` transact (`kind`) on that content?
//
// Semantics by scope:
//   private      → only the owner (view); nobody else, and no transaction.
//   friendCircle → viewer must share at least one circle with the owner (view); no public transact.
//   visible      → public view; no transaction.
//   lendable/swappable/tradeable → public view; transaction allowed when `kind` matches the scope.
//
// The owner can always see and transact their own content, regardless of scope.
export const VisibilityPolicy = {
  // `sharedCircles` is the set of circles the viewer and owner are BOTH members of (already
  // intersected by the caller). Its emptiness is the only friend-circle fact the policy needs.
  canView(
    viewer: MemberId,
    ownerId: MemberId,
    scope: VisibilityScope,
    sharedCircles: readonly CircleId[],
  ): boolean {
    if (viewer === ownerId) return true;
    if (scope === "private") return false;
    if (scope === "friendCircle") return sharedCircles.length > 0;
    return isPubliclyViewable(scope);
  },

  canTransact(
    viewer: MemberId,
    ownerId: MemberId,
    scope: VisibilityScope,
    sharedCircles: readonly CircleId[],
    kind: TransactionKind,
  ): boolean {
    if (viewer === ownerId) return true;
    // A transaction always presupposes the right to view; private/friendCircle/visible never
    // grant a public transaction (a friendCircle copy is shareable, not tradeable, by this policy).
    if (!this.canView(viewer, ownerId, scope, sharedCircles)) return false;
    return permitsTransaction(scope, kind);
  },
};
