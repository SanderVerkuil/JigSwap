import { CatalogSnapshot, OwnerId, PuzzleDefinitionId } from "../../domain";
import {
  CatalogSnapshotProvider,
  PuzzleAcquisitionContext,
  PuzzleApprovalStatus,
} from "../ports/out/catalog-snapshot.provider";

// Seedable in-memory CatalogSnapshotProvider. Tests register definitions via `seed` (status
// defaults to "approved" so existing happy-path tests keep working); unknown definitions read as
// null (simulating a Catalog miss).
export class FakeCatalogSnapshotProvider implements CatalogSnapshotProvider {
  private readonly contexts = new Map<
    PuzzleDefinitionId,
    PuzzleAcquisitionContext
  >();

  seed(
    snapshot: CatalogSnapshot,
    options?: { status?: PuzzleApprovalStatus; submitterId?: OwnerId },
  ): this {
    this.contexts.set(snapshot.puzzleDefinitionId, {
      snapshot,
      status: options?.status ?? "approved",
      submitterId:
        options?.submitterId ??
        (snapshot.puzzleDefinitionId as unknown as OwnerId),
    });
    return this;
  }

  async getAcquisitionContext(
    puzzleDefinitionId: PuzzleDefinitionId,
  ): Promise<PuzzleAcquisitionContext | null> {
    return this.contexts.get(puzzleDefinitionId) ?? null;
  }
}
