import { CatalogSnapshot, OwnerId, PuzzleDefinitionId } from "../../../domain";

// The moderation status a Catalog definition can be in. Mirrors the Catalog's own lifecycle
// but is held here (not in the snapshot) so the Library can authorise acquisition WITHOUT
// persisting moderation state into the display-only Copy snapshot.
export type PuzzleApprovalStatus =
  "pending" | "approved" | "rejected" | "disabled";

// The acquisition context the use case needs to decide IF a member may acquire a definition,
// plus the snapshot to cache once it may. `submitterId` is the Member who contributed the
// definition (a member may acquire their own not-yet-approved submission).
export interface PuzzleAcquisitionContext {
  readonly snapshot: CatalogSnapshot;
  readonly status: PuzzleApprovalStatus;
  readonly submitterId: OwnerId;
}

// Outbound port: how the Library obtains the acquisition context for a PuzzleDefinitionId. This
// is the ACL SOURCE — the only seam through which Catalog product data enters the Library. The
// real adapter reads the Catalog read model / `puzzles` table and maps it; the Library never
// imports the Catalog context. Returns null when the definition is unknown to the Catalog.
export interface CatalogSnapshotProvider {
  getAcquisitionContext(
    puzzleDefinitionId: PuzzleDefinitionId,
  ): Promise<PuzzleAcquisitionContext | null>;
}
