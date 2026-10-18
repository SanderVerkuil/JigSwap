import {
  SharingVisibilityPolicy,
  type CircleId,
  type Copy,
  type MemberId,
  type OwnerId,
  type VisibilityPolicy,
  type VisibilityScope,
} from "@jigswap/domain";

// Cross-context wiring: a friend-circle-aware VisibilityPolicy that REPLACES DefaultVisibilityPolicy
// in the Library reads. Circle I/O happens in the caller (collectCircleSharedCopies); the decision delegates to
// Sharing's PURE VisibilityPolicy service (re-exported as SharingVisibilityPolicy to dodge the
// flat-barrel name clash with this very Library port).
//
// The Library port is synchronous, so circle facts must be pre-resolved by the caller: per copy, the
// circles that copy was shared into which the viewer AND the copy's owner currently belong to
// (#181 — never merely any circle the two happen to share). The returned policy is then a pure,
// synchronous function of those precomputed facts.

// Map a Library Copy's SharingSetting to a Sharing VisibilityScope. The copy's visibility is the
// EFFECTIVE one (copyMapper -> effectiveCopyVisibility): a legacy row's untrusted stored "private"
// loads as "visible", so "private" here is always the owner's per-copy choice. That maps to the
// "private" scope — no circle visibility — matching canViewCopy's isCopyPrivate early return.
// Public/availability behaviour is preserved exactly.
const scopeOf = (copy: Copy): VisibilityScope => {
  const sharing = copy.sharing;
  if (sharing.isAvailableFor("trade")) return "tradeable";
  if (sharing.isAvailableFor("sale")) return "tradeable";
  if (sharing.isAvailableFor("lend")) return "lendable";
  if (sharing.visibility === "visible") return "visible";
  return "private";
};

// The transaction kind a Library Copy is offered for (if any), to gate Sharing's transact check.
const transactKindOf = (copy: Copy): "lend" | "swap" | "trade" | null => {
  const sharing = copy.sharing;
  if (sharing.isAvailableFor("trade")) return "trade";
  if (sharing.isAvailableFor("sale")) return "trade";
  if (sharing.isAvailableFor("lend")) return "lend";
  return null;
};

export const makeCircleAwareVisibilityPolicy = (
  sharedCircles: (copy: Copy) => readonly CircleId[],
): VisibilityPolicy => {
  return {
    canView(viewer: OwnerId, copy: Copy): boolean {
      return SharingVisibilityPolicy.canView(
        viewer as unknown as MemberId,
        copy.ownerId as unknown as MemberId,
        scopeOf(copy),
        sharedCircles(copy),
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
        sharedCircles(copy),
        kind,
      );
    },
  };
};
