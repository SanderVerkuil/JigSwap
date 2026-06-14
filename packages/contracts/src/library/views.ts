// Personal Library read-model view DTOs: the typed shapes the gateway's `library:` and
// `collections:` reads return, replacing raw Convex rows. Each is a faithful superset of exactly
// what today's UI consumers read, so the read cutover is behaviour-preserving. Ids are surfaced as
// the opaque strings they are at runtime; the web app re-casts to its own `Id<...>` at the edge.

import type { DocId, PuzzleDifficulty } from "../catalog/views";
import type { ProjectedMember } from "../social/social";

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

// --- Copy instance (owned-copy) timeline -------------------------------------------------------
// The privacy-gated provenance of a single owned copy: its catalog snapshot, the (projected) owner,
// and one merged chronological event stream (ownership transfers, completions, loans). Every member
// surfaced in the stream is a ProjectedMember, anonymised server-side per the viewer's connection so
// private identities never cross the wire. The stream is split into `since` (events while the viewer
// has held the copy) and `before` (its history before they acquired it); non-owners see everything
// in `before`. Returned by `library.getCopyInstanceView`.

/** An ownership transfer in a copy's history (from the custody projection). */
export interface CopyInstanceTransferEntry {
  type: "transfer";
  /** The member the copy moved FROM (projected). */
  from: ProjectedMember;
  /** The member the copy moved TO (projected). */
  to: ProjectedMember;
  /** Whether the transfer settled via an exchange (true when an exchange id is recorded). */
  viaExchange: boolean;
  /** Epoch millis the transfer occurred. */
  occurredAt: number;
}

/** A completion of the copy (from the solving projection). */
export interface CopyInstanceCompletionEntry {
  type: "completion";
  /** The member who solved it (projected). */
  solver: ProjectedMember;
  startDate: number;
  endDate?: number;
  timeMinutes?: number;
  /** Sort key: the completion's `endDate` if finished, else its `startDate`. */
  occurredAt: number;
}

/** A loan of the copy's possession (from the lending projection). */
export interface CopyInstanceLoanEntry {
  type: "loan";
  /** The lender (projected). */
  lender: ProjectedMember;
  /** The borrower (projected). */
  borrower: ProjectedMember;
  openedAt: number;
  closedAt?: number;
  status: "open" | "returned" | "recalled";
  /** Sort key: when the loan opened. */
  occurredAt: number;
}

/** One entry in a copy's merged timeline. Discriminated on `type`. */
export type CopyInstanceTimelineEntry =
  | CopyInstanceTransferEntry
  | CopyInstanceCompletionEntry
  | CopyInstanceLoanEntry;

// --- Type-grouped history (richer detail page) -------------------------------------------------
// The same three history sources as the merged timeline, but grouped by type and carrying the extra
// per-record facts the detail page renders (rating/note/finish duration). Every member is still
// privacy-projected (salt = copyId). Each list is descending by `occurredAt` (newest first).

/** A finished completion of this copy, for the grouped completions list. */
export interface CopyCompletionEntry {
  /** The member who solved it (projected). */
  solver: ProjectedMember;
  /** Whether the solver is the acting viewer. */
  isYou: boolean;
  /** Epoch millis the completion is sorted/dated on (its `endDate`, else `startDate`). */
  occurredAt: number;
  /**
   * How long the solve took, in whole days: `endDate - startDate` rounded to whole days when both
   * are present, else `completionTimeMinutes / 1440` rounded, else null.
   */
  finishDays: number | null;
  /** The 1-5 star rating, or null when unrated. */
  rating: number | null;
  /** The free-text review, or null when absent. */
  note: string | null;
}

/** A loan of this copy, for the grouped loans list. */
export interface CopyLoanEntry {
  /** The lender (projected). */
  lender: ProjectedMember;
  /** The borrower (projected). */
  borrower: ProjectedMember;
  /** Epoch millis the loan opened. */
  openedAt: number;
  /** Epoch millis the loan closed, or null while open. */
  closedAt: number | null;
  status: "open" | "returned" | "recalled";
}

/** An ownership transfer of this copy, for the grouped transfers list. */
export interface CopyTransferEntry {
  /** The member the copy moved FROM (projected). */
  from: ProjectedMember;
  /** The member the copy moved TO (projected). */
  to: ProjectedMember;
  /** Whether the transfer settled via an exchange. */
  viaExchange: boolean;
  /** Epoch millis the transfer occurred. */
  occurredAt: number;
}

/** Per-copy aggregate stats the detail page surfaces. */
export interface CopyInstanceStats {
  /** Number of completed completions of this copy. */
  timesCompleted: number;
  /** The smallest `finishDays` across completed completions, or null when none. */
  fastestFinishDays: number | null;
  /** Number of loans recorded for this copy. */
  timesLentOut: number;
  /**
   * The VIEWER's own average rating (1 decimal) across their rated completions of this copy, or
   * null when they have none rated.
   */
  yourAvgRating: number | null;
}

/** Community-wide rating aggregate over ALL rated completions of the copy's puzzle DEFINITION. */
export interface CopyInstanceCommunity {
  /** Average rating to 1 decimal across rated completions (0 when none). */
  rating: number;
  /** Number of rated completions. */
  count: number;
  /** Counts per star bucket, ordered [5★, 4★, 3★, 2★, 1★]. */
  breakdown: [number, number, number, number, number];
}

/** A resolved gallery photo for this copy, with the metadata a lightbox needs. */
export interface CopyPhoto {
  /** The `ownedPuzzleImages` _id as a string. Keys the photo's comment thread in the lightbox. */
  id: string;
  /** The resolved storage URL. */
  url: string;
  /** The caption (`title ?? tag`), or null when absent. */
  caption: string | null;
  /** The photo's tag (e.g. `box_front`), or null when absent. */
  tag: string | null;
  /** The uploader-provided description, or null when absent. */
  description: string | null;
  /** The uploader's display name, or null when the uploader could not be resolved. */
  uploaderName: string | null;
  /** When the photo was taken (epoch ms), or null when not recorded. */
  takenAt: number | null;
  /** When the photo row was created (epoch ms). */
  createdAt: number;
  /**
   * The async moderation verdict: "approved" (default — also when the row predates moderation),
   * or "pending" while the moderation pipeline runs. A "pending" photo is only ever included for
   * its own uploader, who can show a "pending review" badge; rejected photos are never returned.
   */
  moderationStatus: "approved" | "pending";
}

/**
 * The privacy-gated detail view of a single owned copy, as returned by
 * `library.getCopyInstanceView`. `owner` and every participant in `since`/`before` are projected
 * server-side. `since`/`before` are each ascending by `occurredAt`.
 */
export interface CopyInstanceView {
  /** The copy's `ownedPuzzles` _id. */
  copyId: DocId;
  /**
   * The domain CopyId (aggregateId). The copy-edit mutations (changeCondition, updateSharing,
   * updateDetails) and recordCompletion key on this, not the `_id`. Null for legacy rows.
   */
  aggregateId: string | null;
  /** Whether the acting viewer currently owns this copy. */
  viewerIsOwner: boolean;
  /** The (projected) current owner. */
  owner: ProjectedMember;
  /** Catalog/condition snapshot of the copy. */
  snapshot: {
    title: string;
    brand?: string;
    pieceCount: number;
    /**
     * The resolved cover image URL: the selected per-copy photo when one is chosen and resolvable,
     * otherwise the puzzle's global catalogue image.
     */
    image?: string;
    /**
     * The chosen cover photo's `ownedPuzzleImages` id, or null when none is selected (the global
     * image is in use). Lets the cover picker show the current selection.
     */
    coverImageId: string | null;
    condition: CopyCondition;
    notes?: string;
    availability: CopyAvailability;
    acquisitionDate?: number;
    acquisitionSource?: "bought_new" | "bought_used" | "trade" | "gift";
    /** The puzzle definition's difficulty, when set. */
    difficulty?: PuzzleDifficulty;
    /** The puzzle definition's tags (empty array when none). */
    tags: string[];
  };
  /**
   * When the viewer acquired the copy (the latest custody transfer to them, else the copy's
   * creation time). Only meaningful when `viewerIsOwner` is true.
   */
  acquiredByViewerAt: number;
  /** Events at/after `acquiredByViewerAt` (the viewer's own tenure). Empty for non-owners. */
  since: CopyInstanceTimelineEntry[];
  /** Events before `acquiredByViewerAt` (gated history). All events for non-owners. */
  before: CopyInstanceTimelineEntry[];
  /** Every completed completion of this copy, newest first. Members privacy-projected. */
  completions: CopyCompletionEntry[];
  /** Every loan of this copy, newest first. Members privacy-projected. */
  loans: CopyLoanEntry[];
  /** Every ownership transfer of this copy, newest first. Members privacy-projected. */
  transfers: CopyTransferEntry[];
  /** Per-copy aggregate stats. */
  stats: CopyInstanceStats;
  /** Community-wide rating aggregate over the copy's puzzle definition (no identities). */
  community: CopyInstanceCommunity;
  /** Resolved gallery photos for this copy, newest first. */
  gallery: CopyPhoto[];
}

// --- Catalog puzzle-DEFINITION detail page -----------------------------------------------------
// The redesigned catalog detail view for a puzzle DEFINITION (not a single owned copy). Aggregates
// the community's rating distribution, ownership/completion stats, the viewer's own ownership, and a
// short list of REACHABLE available copies the viewer could swap/lend/buy. Returned by
// `library.getPuzzleDefinitionView`. Distinct from the catalog row DTO `PuzzleDefinitionView`.

/** How an offered copy is available, in priority order: trade -> "swap", lend -> "lend", sale -> "sale". */
export type CopyOfferSwapType = "swap" | "lend" | "sale";

/**
 * One reachable, available copy of the puzzle the viewer could acquire, as surfaced on the catalog
 * detail page. The owner is REACHABLE by construction (their profile is public OR the copy is shared
 * into a circle the viewer belongs to — the same gate Browse applies), so their name/location/avatar
 * and aggregate reputation are shown un-anonymised. `avgRating` is the owner's average partner-review
 * rating (null when they have no reviews yet).
 */
export interface CopyOfferView {
  copyId: DocId;
  swapType: CopyOfferSwapType;
  owner: {
    name: string;
    location: string | null;
    avatarUrl: string | null;
    avgRating: number | null;
  };
}

/**
 * The redesigned catalog detail view of a puzzle DEFINITION, as returned by
 * `library.getPuzzleDefinitionView` (null when the puzzle does not exist). Auth-gated; the acting
 * member is the viewer. `availableCopies` is capped at 5 (newest first); `totalAvailable` is the full
 * count of reachable available copies for a "See all N" affordance.
 */
export interface PuzzleDefinitionDetailView {
  /** Catalog facts of the puzzle definition. */
  definition: {
    title: string;
    brand?: string;
    pieceCount: number;
    /** Resolved box-art URL (when the definition has one). */
    image?: string;
    difficulty?: PuzzleDifficulty;
    /** The English name of the definition's category, when it has one. */
    categoryName?: string;
    tags: string[];
    description?: string;
  };
  /** Community rating distribution over this definition's rated reviews (`puzzleComments` with a rating). */
  rating: {
    /** Average rating to 1 decimal across rated reviews (0 when none). */
    rating: number;
    /** Number of rated reviews. */
    count: number;
    /** Counts per star bucket, ordered [5★, 4★, 3★, 2★, 1★]. */
    breakdown: [number, number, number, number, number];
    /** Each bucket as a percentage of `count`, rounded (all 0 when `count` is 0), same order. */
    percentages: [number, number, number, number, number];
  };
  /** Community-wide ownership/completion/availability stats for this definition. */
  stats: {
    /** Distinct owners holding a copy of this definition. */
    communityOwners: number;
    /** Completed completions recorded against this definition. */
    totalCompletions: number;
    /** Mean finish-days across completed completions, or null when none. */
    avgCompletionDays: number | null;
    /** Reachable available copies the viewer could acquire (excludes the viewer's own). */
    availableToSwap: number;
  };
  /** Whether (and how) the acting viewer owns a copy of this definition. */
  ownership: {
    viewerOwns: boolean;
    /** The viewer's owning copy's `ownedPuzzles` _id, or null when they own none. */
    copyId: string | null;
    /** The viewer's owning copy's condition, or null when they own none. */
    condition: string | null;
  };
  /** Up to 5 reachable available copies, newest first. */
  availableCopies: CopyOfferView[];
  /** Total count of reachable available copies (for "See all N"). */
  totalAvailable: number;
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
