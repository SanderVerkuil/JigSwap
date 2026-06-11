// Insights read-model view DTOs: the typed shapes the gateway's `insights:` reads return.

/** Minimal public view of a catalog puzzle for the marketing hero plank. */
export interface PlankPuzzleView {
  title: string;
  pieceCount: number;
  brand?: string;
  /** Resolved cover URL, if the puzzle has box art. */
  image: string | null;
}
