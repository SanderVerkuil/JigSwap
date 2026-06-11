import { CopyId, MemberId } from "../../../domain";

// The Exchange context's read-only view of a Personal Library copy. This is the seam
// (anti-corruption boundary) to Library: Exchange depends on this shape, not on Library's
// tables. The real adapter over `ownedPuzzles` arrives in 1b-convex.
export interface CopyView {
  readonly id: CopyId;
  readonly ownerId: MemberId;
  readonly availability: {
    readonly forTrade: boolean;
    readonly forSale: boolean;
    readonly forLend: boolean;
  };
}

// Outbound port: read access to a copy. Reservation/locking is deferred to Phase 2 (Library)
// and is therefore intentionally absent here.
export interface CopyPort {
  getCopy(copyId: CopyId): Promise<CopyView | null>;
}
