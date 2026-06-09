import { CatalogSnapshot, PuzzleDefinitionId } from "../../../domain";

// Outbound port: how the Library obtains (or refreshes) a CatalogSnapshot for a given
// PuzzleDefinitionId. This is the ACL SOURCE — the only seam through which the Catalog product
// data enters the Library. The real adapter (2c) reads the Catalog read model / `puzzles`
// table and maps it into a CatalogSnapshot; the Library never imports the Catalog context.
// Returns null when the definition is unknown to the Catalog.
export interface CatalogSnapshotProvider {
  getSnapshot(
    puzzleDefinitionId: PuzzleDefinitionId,
  ): Promise<CatalogSnapshot | null>;
}
