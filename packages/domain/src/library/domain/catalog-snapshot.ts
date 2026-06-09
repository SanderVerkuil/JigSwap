import { PuzzleDefinitionId } from "./ids";

// The ACL cache of the Catalog product. This is the ONLY thing a Copy knows about the
// product it instantiates: a denormalised, immutable snapshot taken at acquisition (and
// refreshable via the CatalogSnapshotProvider port). The Library keeps working if the
// Catalog evolves because it never reaches into Catalog tables. (proposal §1.3 relationship 2)
export class CatalogSnapshot {
  private constructor(
    readonly puzzleDefinitionId: PuzzleDefinitionId,
    readonly title: string,
    readonly pieceCount: number,
    readonly brand?: string,
    readonly thumbnail?: string,
  ) {}

  static create(props: {
    readonly puzzleDefinitionId: PuzzleDefinitionId;
    readonly title: string;
    readonly pieceCount: number;
    readonly brand?: string;
    readonly thumbnail?: string;
  }): CatalogSnapshot {
    return new CatalogSnapshot(
      props.puzzleDefinitionId,
      props.title,
      props.pieceCount,
      props.brand,
      props.thumbnail,
    );
  }
}
