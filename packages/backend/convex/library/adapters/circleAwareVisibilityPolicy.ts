import {
  type Copy,
  type CircleId,
  type MemberId,
  type OwnerId,
  SharingVisibilityPolicy,
  type VisibilityPolicy,
  type VisibilityScope,
} from "@jigswap/domain";
import type { QueryCtx } from "../../_generated/server";
import { convexCircleRepository } from "../../sharing/adapters/convexCircleRepository";

// Cross-context wiring: a friend-circle-aware VisibilityPolicy that REPLACES DefaultVisibilityPolicy
// in the Library reads. All circle I/O happens here in the adapter; the actual decision delegates to
// Sharing's PURE VisibilityPolicy service (re-exported as SharingVisibilityPolicy to dodge the
// flat-barrel name clash with this very Library port).
//
// The Library port is synchronous, so circle facts must be pre-resolved. `prepare` loads the
// viewer's circles once and, per owner, the owner's circles, caching the intersected sharedCircles.
// The returned policy is then a pure, synchronous function of those precomputed facts.

// Map a Library Copy's SharingSetting to a Sharing VisibilityScope. The current SharingSetting has
// no explicit "friendCircle" value; a private-but-circle-shared copy is treated as friendCircle so
// circle members gain view. Public/availability behaviour is preserved exactly.
const scopeOf = (copy: Copy): VisibilityScope => {
  const sharing = copy.sharing;
  if (sharing.isAvailableFor("trade")) return "tradeable";
  if (sharing.isAvailableFor("sale")) return "tradeable";
  if (sharing.isAvailableFor("lend")) return "lendable";
  if (sharing.visibility === "visible") return "visible";
  return "friendCircle"; // private copies fall back to circle-scoped visibility
};

// The transaction kind a Library Copy is offered for (if any), to gate Sharing's transact check.
const transactKindOf = (copy: Copy): "lend" | "swap" | "trade" | null => {
  const sharing = copy.sharing;
  if (sharing.isAvailableFor("trade")) return "trade";
  if (sharing.isAvailableFor("sale")) return "trade";
  if (sharing.isAvailableFor("lend")) return "lend";
  return null;
};

export const makeCircleAwareVisibilityPolicy = async (
  ctx: QueryCtx,
  viewerId: OwnerId,
  ownerIds: readonly OwnerId[],
): Promise<VisibilityPolicy> => {
  const circles = convexCircleRepository(ctx);
  const viewer = viewerId as unknown as MemberId;

  // Load the viewer's circles once; index by CircleId for cheap intersection.
  const viewerCircles = await circles.listForMember(viewer);
  const viewerCircleIds = new Set(viewerCircles.map((c) => c.id as string));

  // Per distinct owner, the circles the viewer and owner BOTH belong to (the only fact the policy
  // needs). Loading the owner's circles and intersecting is the entire I/O surface.
  const sharedByOwner = new Map<string, CircleId[]>();
  for (const ownerId of new Set(ownerIds.map((o) => o as string))) {
    const ownerCircles = await circles.listForMember(
      ownerId as unknown as MemberId,
    );
    const shared = ownerCircles
      .map((c) => c.id)
      .filter((id) => viewerCircleIds.has(id as string));
    sharedByOwner.set(ownerId, shared);
  }

  const sharedCircles = (ownerId: OwnerId): readonly CircleId[] =>
    sharedByOwner.get(ownerId as string) ?? [];

  return {
    canView(viewer: OwnerId, copy: Copy): boolean {
      return SharingVisibilityPolicy.canView(
        viewer as unknown as MemberId,
        copy.ownerId as unknown as MemberId,
        scopeOf(copy),
        sharedCircles(copy.ownerId),
      );
    },

    canTransact(viewer: OwnerId, copy: Copy): boolean {
      // Cannot transact with yourself (preserves DefaultVisibilityPolicy behaviour).
      if (viewer === copy.ownerId) return false;
      const kind = transactKindOf(copy);
      if (!kind) return false;
      return SharingVisibilityPolicy.canTransact(
        viewer as unknown as MemberId,
        copy.ownerId as unknown as MemberId,
        scopeOf(copy),
        sharedCircles(copy.ownerId),
        kind,
      );
    },
  };
};
