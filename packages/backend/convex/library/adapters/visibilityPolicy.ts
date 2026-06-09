import { DefaultVisibilityPolicy, type VisibilityPolicy } from "@jigswap/domain";

// The default VisibilityPolicy instance (public/private + exchange-availability, no friend
// circles). Phase 6 swaps in a friend-circle-aware implementation without touching the use cases.
export const defaultVisibilityPolicy: VisibilityPolicy =
  new DefaultVisibilityPolicy();
