import { Copy, OwnerId } from "../../../domain";

// Outbound port: resolves the "Visibility / Availability is a policy decision, not a row
// boolean" rule (§1.5). A viewer's right to SEE a copy (`canView`) and to TRANSACT on it
// (`canTransact`) are policy questions. Keeping this a port lets Phase 6 (Friend Circles) swap
// in a friend-circle-aware implementation without touching the Library use cases.
export interface VisibilityPolicy {
  canView(viewer: OwnerId, copy: Copy): boolean;
  canTransact(viewer: OwnerId, copy: Copy): boolean;
}

// The DEFAULT policy: public/private + exchange-availability flags only (no friend circles).
//   - The owner always sees and may transact on their own copy.
//   - A non-owner may VIEW a copy that is publicly visible (public, or offered for exchange).
//   - A non-owner may TRANSACT only on a copy offered for at least one exchange kind.
// Friend-Circle scoping plugs in at Phase 6 by replacing this implementation.
export class DefaultVisibilityPolicy implements VisibilityPolicy {
  canView(viewer: OwnerId, copy: Copy): boolean {
    if (viewer === copy.ownerId) return true;
    return copy.sharing.isPubliclyVisible();
  }

  canTransact(viewer: OwnerId, copy: Copy): boolean {
    if (viewer === copy.ownerId) return false; // cannot transact with yourself
    return copy.sharing.isAvailableForAnyExchange();
  }
}
