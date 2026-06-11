import type { ConvexSystemFields } from "../shared/convex";

/**
 * The Catalog puzzle definition document (`puzzles` table), embedded on exchange views exactly as
 * the legacy reads joined it (`requestedPuzzle` / `offeredPuzzle`). Faithful superset so consumers
 * reading `title` / `pieceCount` keep working. Optional fields mirror the schema's optionals.
 */
export interface ExchangePuzzleView extends ConvexSystemFields {
  aggregateId?: string;
  title: string;
  description?: string;
  brand?: string;
  pieceCount: number;
  artist?: string;
  series?: string;
  ean?: string;
  upc?: string;
  modelNumber?: string;
  dimensions?: { width: number; height: number; unit: "cm" | "in" };
  shape?: "rectangular" | "panoramic" | "round" | "shaped";
  difficulty?: "easy" | "medium" | "hard" | "expert";
  category?: string;
  tags?: string[];
  image?: string;
  searchableText?: string;
  status: "pending" | "approved" | "rejected";
  submittedBy: string;
  createdAt: number;
  updatedAt: number;
}

/**
 * An owned copy document (`ownedPuzzles` table), embedded on exchange views as the legacy reads
 * joined it (`requestedOwnedPuzzle` / `offeredOwnedPuzzle`, and `ownerPuzzle`/`requesterPuzzle` on
 * the single-exchange view). Faithful superset of the row.
 */
export interface ExchangeOwnedPuzzleView extends ConvexSystemFields {
  aggregateId?: string;
  puzzleId: string;
  puzzleDefinitionId?: string;
  snapshot?: {
    title: string;
    brand?: string;
    pieceCount: number;
    thumbnail?: string;
  };
  ownerId: string;
  condition: "new_sealed" | "like_new" | "good" | "fair" | "poor";
  missingPiecesCount?: number;
  notes?: string;
  availability: { forTrade: boolean; forSale: boolean; forLend: boolean };
  visibility?: "private" | "visible";
  salePrice?: { amount: number; currency: string };
  acquisitionDate?: number;
  acquisitionSource?: "bought_new" | "bought_used" | "trade" | "gift";
  acquisitionPrice?: { amount: number; currency: string };
  createdAt: number;
  updatedAt: number;
}
