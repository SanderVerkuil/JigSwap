import {
  PuzzleMatch,
  PuzzleMatchLookup,
} from "../ports/out/puzzle-match-lookup";

export class FakePuzzleMatchLookup implements PuzzleMatchLookup {
  public calls: Array<{ ean?: string; upc?: string }> = [];
  private match: PuzzleMatch | null = null;

  seedMatch(match: PuzzleMatch | null): void {
    this.match = match;
  }

  async findByBarcode(barcodes: {
    ean?: string;
    upc?: string;
  }): Promise<PuzzleMatch | null> {
    this.calls.push(barcodes);
    return this.match;
  }
}
