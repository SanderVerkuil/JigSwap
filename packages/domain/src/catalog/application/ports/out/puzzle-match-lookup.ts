// A minimal summary of an existing catalog puzzle that matches an extracted barcode. Drives the
// "already on JigSwap - add to your collection" branch. `aggregateId` is the Catalog
// PuzzleDefinitionId the acquire-copy flow keys on; legacy rows may lack it.
export interface PuzzleMatch {
  readonly puzzleId: string;
  readonly aggregateId?: string;
  readonly title: string;
  readonly brand?: string;
  readonly pieceCount: number;
  readonly imageUrl?: string;
}

export interface PuzzleMatchLookup {
  findByBarcode(barcodes: {
    ean?: string;
    upc?: string;
  }): Promise<PuzzleMatch | null>;
}
