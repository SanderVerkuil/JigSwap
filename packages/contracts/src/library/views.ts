// Personal Library read-model view DTOs: the typed shapes the gateway's `library:` and
// `collections:` reads return, replacing raw Convex rows. Each is a faithful superset of exactly
// what today's UI consumers read, so the read cutover is behaviour-preserving. Ids are surfaced as
// the opaque strings they are at runtime; the web app re-casts to its own `Id<...>` at the edge.

import type { DocId, PuzzleDifficulty } from "../catalog/views";

export type CopyCondition =
  | "new_sealed"
  | "like_new"
  | "good"
  | "fair"
  | "poor";

export interface CopyAvailability {
  forTrade: boolean;
  forSale: boolean;
  forLend: boolean;
}

/**
 * The Catalog snapshot a Copy carries when joined into a Library view. Mirrors the puzzles row a
 * legacy owned-puzzle read spread under `puzzle`. `images` is declared (UI consumers reference it)
 * but the read does not populate it — preserving today's behaviour where the box-art never joined in.
 */
export interface OwnedCopyPuzzleView {
  _id: DocId;
  _creationTime?: number;
  aggregateId?: string;
  title: string;
  description?: string;
  brand?: string;
  pieceCount: number;
  difficulty?: PuzzleDifficulty;
  category?: DocId;
  tags?: string[];
  images?: string[];
  createdAt: number;
  updatedAt: number;
}

/** The owner summary a browse/detail read joins onto a Copy. */
export interface OwnedCopyOwnerView {
  _id: DocId;
  name: string;
  username?: string;
  avatar?: string;
}

/**
 * A member's owned copy with its joined Catalog puzzle (and optionally owner), as returned by
 * `library.ownedByOwner` and the items of `library.browseOwned` / `collections.byId`. Superset of
 * the legacy spread owned-puzzle row so every PuzzleCard consumer keeps working unchanged.
 */
export interface OwnedCopyView {
  _id: DocId;
  _creationTime?: number;
  aggregateId?: string;
  puzzleId: DocId;
  puzzleDefinitionId?: string;
  ownerId: DocId;
  condition: CopyCondition;
  missingPiecesCount?: number;
  notes?: string;
  availability: CopyAvailability;
  visibility?: "private" | "visible";
  salePrice?: { amount: number; currency: string };
  acquisitionDate?: number;
  acquisitionSource?: "bought_new" | "bought_used" | "trade" | "gift";
  acquisitionPrice?: { amount: number; currency: string };
  snapshot?: {
    title: string;
    brand?: string;
    pieceCount: number;
    thumbnail?: string;
  };
  createdAt: number;
  updatedAt: number;
  // Present only when the Copy is surfaced as a collection member (`collections.byId`).
  addedAt?: number;
  puzzle: OwnedCopyPuzzleView | null;
  // Present only on reads that join the owner (`library.browseOwned`).
  owner?: OwnedCopyOwnerView | null;
}

/** The paginated wrapper `library.browseOwned` returns (offset/limit paging, not Convex cursors). */
export interface BrowseOwnedCopiesView {
  ownedPuzzles: OwnedCopyView[];
  total: number;
  hasMore: boolean;
}

/** A stored image row for an owned copy, as joined into `library.ownedWithCollectionStatus`. */
export interface OwnedCopyImageView {
  _id: DocId;
  _creationTime: number;
  ownedPuzzleId: DocId;
  uploaderId: DocId;
  fileId: DocId;
  title?: string;
  description?: string;
  tag?: "box_front" | "box_back" | "pieces" | "completed" | "damage_detail";
  takenAt?: number;
  createdAt: number;
  updatedAt: number;
}

/** A completion record joined into `library.ownedWithCollectionStatus`. */
export interface OwnedCopyCompletionView {
  _id: DocId;
  _creationTime: number;
  aggregateId?: string;
  userId: DocId;
  puzzleId?: DocId;
  ownedPuzzleId?: DocId;
  startDate: number;
  endDate?: number;
  completionTimeMinutes?: number;
  rating?: number;
  review?: string;
  notes?: string;
  photos: DocId[];
  isCompleted: boolean;
  createdAt: number;
  updatedAt: number;
}

/** The current member's collection status for a copy, on `library.ownedWithCollectionStatus`. */
export type OwnedCopyCollectionStatusView =
  | {
      isInCollection: true;
      visibility: "private" | "public";
      personalNotes?: string;
    }
  | { isInCollection: false };

/**
 * A single owned copy enriched with its image rows, owner, the member's collection status, and
 * completion history, as returned by `library.ownedWithCollectionStatus`. Superset of the legacy
 * spread row. Note `images` here are the raw image ROWS (consumers read `images[0].fileId`),
 * distinct from `OwnedCopyView.puzzle.images`.
 */
export interface OwnedCopyDetailView {
  _id: DocId;
  _creationTime?: number;
  aggregateId?: string;
  puzzleId: DocId;
  puzzleDefinitionId?: string;
  ownerId: DocId;
  condition: CopyCondition;
  missingPiecesCount?: number;
  notes?: string;
  availability: CopyAvailability;
  visibility?: "private" | "visible";
  salePrice?: { amount: number; currency: string };
  acquisitionDate?: number;
  acquisitionSource?: "bought_new" | "bought_used" | "trade" | "gift";
  acquisitionPrice?: { amount: number; currency: string };
  snapshot?: {
    title: string;
    brand?: string;
    pieceCount: number;
    thumbnail?: string;
  };
  createdAt: number;
  updatedAt: number;
  puzzle: OwnedCopyPuzzleView;
  images: OwnedCopyImageView[];
  owner: OwnedCopyOwnerView | null;
  collectionStatus: OwnedCopyCollectionStatusView;
  completionHistory: OwnedCopyCompletionView[];
}

/**
 * A member's collection with its derived puzzle count, as returned by `collections.listForUser`.
 * Superset of the legacy spread collection row.
 */
export interface CollectionView {
  _id: DocId;
  _creationTime: number;
  aggregateId?: string;
  userId: DocId;
  name: string;
  description?: string;
  visibility: "private" | "public";
  color?: string;
  icon?: string;
  isDefault: boolean;
  isWishlist?: boolean;
  wishedDefinitions?: string[];
  personalNotes?: string;
  createdAt: number;
  updatedAt: number;
  puzzleCount: number;
}

/**
 * A collection with its member copies resolved, as returned by `collections.byId`. The `puzzles`
 * entries are owned copies carrying `addedAt`; the UI keys removals on their aggregateIds.
 */
export interface CollectionDetailView {
  _id: DocId;
  _creationTime: number;
  aggregateId?: string;
  userId: DocId;
  name: string;
  description?: string;
  visibility: "private" | "public";
  color?: string;
  icon?: string;
  isDefault: boolean;
  isWishlist?: boolean;
  wishedDefinitions?: string[];
  personalNotes?: string;
  createdAt: number;
  updatedAt: number;
  puzzles: OwnedCopyView[];
}

/**
 * A collection that contains a given copy, as returned by `collections.forOwnedPuzzle`. This is the
 * bare collection row (no derived puzzleCount) the legacy read returned; consumers key on `_id`.
 */
export interface CollectionMembershipView {
  _id: DocId;
  _creationTime: number;
  aggregateId?: string;
  userId: DocId;
  name: string;
  description?: string;
  visibility: "private" | "public";
  color?: string;
  icon?: string;
  isDefault: boolean;
  isWishlist?: boolean;
  wishedDefinitions?: string[];
  personalNotes?: string;
  createdAt: number;
  updatedAt: number;
}
