import { CatalogSnapshot, PuzzleDefinitionId } from "../../domain";
import { CatalogSnapshotProvider } from "../ports/out/catalog-snapshot.provider";

// Seedable in-memory CatalogSnapshotProvider. Tests register snapshots via `seed`; unknown
// definitions read as null (simulating a Catalog miss).
export class FakeCatalogSnapshotProvider implements CatalogSnapshotProvider {
  private readonly snapshots = new Map<PuzzleDefinitionId, CatalogSnapshot>();

  seed(snapshot: CatalogSnapshot): this {
    this.snapshots.set(snapshot.puzzleDefinitionId, snapshot);
    return this;
  }

  async getSnapshot(
    puzzleDefinitionId: PuzzleDefinitionId,
  ): Promise<CatalogSnapshot | null> {
    return this.snapshots.get(puzzleDefinitionId) ?? null;
  }
}
