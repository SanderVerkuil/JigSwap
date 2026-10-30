import { CopyId, MemberId } from "../../../domain";

// The Exchange context's read-only view of a Personal Library copy. This is the seam
// (anti-corruption boundary) to Library: Exchange depends on this shape, not on Library's
// tables. The real adapter over `ownedPuzzles` arrives in 1b-convex.
export interface CopyView {
  readonly id: CopyId;
  readonly ownerId: MemberId;
  // Members other than the owner who may act as if they owned this copy (household members the
  // owner left at `manage`). Absent ⇒ nobody but the owner.
  readonly coManagerIds?: readonly MemberId[];
  // Who holds the copy now: a borrower while it is out on loan. Absent ⇒ the owner.
  readonly heldBy?: MemberId;
  readonly availability: {
    readonly forTrade: boolean;
    readonly forSale: boolean;
    readonly forLend: boolean;
  };
}

// Outbound port: read access to a copy. Exchange reads it on propose and again on accept and
// confirm (settlement-guard), so a deal settles only while its copies are where it found them.
export interface CopyPort {
  getCopy(copyId: CopyId): Promise<CopyView | null>;
}
