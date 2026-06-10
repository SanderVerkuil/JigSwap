import { DefaultVisibilityPolicy, type VisibilityPolicy } from "@jigswap/domain";

// The default VisibilityPolicy instance (public/private + exchange-availability, no friend
// circles). The friend-circle-aware implementation now lives in `circleAwareVisibilityPolicy.ts`
// and is wired into the browse read; this default remains for the public/no-circle path.
export const defaultVisibilityPolicy: VisibilityPolicy =
  new DefaultVisibilityPolicy();
