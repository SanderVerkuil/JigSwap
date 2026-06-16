import type {
  CollectionDetailView,
  CollectionMembershipView,
  CollectionView,
  OwnedCopyCompletionView,
  OwnedCopyImageView,
  OwnedCopyOwnerView,
  OwnedCopyPuzzleView,
  OwnedCopyView,
} from "@jigswap/contracts";
import type { Doc } from "../_generated/dataModel";

// Row -> view DTO mappers for the Personal Library reads. Pure functions so the mapping is
// unit-testable and `tsc` enforces it against the contracts shapes.

/** The Catalog snapshot a copy carries; `images` is intentionally never populated (legacy never joined box-art). */
export const toOwnedCopyPuzzleView = (
  row: Doc<"puzzles">,
): OwnedCopyPuzzleView => ({
  _id: row._id,
  _creationTime: row._creationTime,
  aggregateId: row.aggregateId,
  title: row.title,
  description: row.description,
  brand: row.brand,
  pieceCount: row.pieceCount,
  difficulty: row.difficulty,
  category: row.category,
  tags: row.tags,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

/** The owner summary joined onto a copy in browse/detail reads. */
export const toOwnedCopyOwnerView = (
  row: Doc<"users">,
): OwnedCopyOwnerView => ({
  _id: row._id,
  name: row.name,
  username: row.username,
  avatar: row.avatar,
});

/**
 * An owned copy with its joined puzzle (and optional owner / collection-membership timestamp).
 *
 * SECURITY: the owner-only personal fields — `notes`, `acquisitionPrice`, `acquisitionSource` — are
 * OMITTED by default and only included when `opts.includeOwnerOnly` is explicitly true (i.e. the
 * caller has established viewer === owner). Stripping owner-only data is opt-OUT at the mapper, not
 * something each call site must remember to do. `salePrice` is NOT owner-only: it is the public
 * asking price for a copy listed `forSale`, so it is always carried (the row only holds it when the
 * owner set one). Callers that surface OTHER members' copies must leave `includeOwnerOnly` at its
 * `false` default.
 */
export const toOwnedCopyView = (
  row: Doc<"ownedPuzzles">,
  puzzle: Doc<"puzzles"> | null,
  opts?: {
    owner?: Doc<"users"> | null;
    addedAt?: number;
    coverUrl?: string | null;
    includeOwnerOnly?: boolean;
  },
): OwnedCopyView => ({
  _id: row._id,
  _creationTime: row._creationTime,
  aggregateId: row.aggregateId,
  puzzleId: row.puzzleId,
  puzzleDefinitionId: row.puzzleDefinitionId,
  ownerId: row.ownerId,
  condition: row.condition,
  missingPiecesCount: row.missingPiecesCount,
  // Owner-only personal fields: only surfaced when the viewer owns the copy.
  notes: opts?.includeOwnerOnly ? row.notes : undefined,
  availability: row.availability,
  visibility: row.visibility,
  // Public asking price for a copy listed for sale — always carried.
  salePrice: row.salePrice,
  acquisitionDate: row.acquisitionDate,
  acquisitionSource: opts?.includeOwnerOnly ? row.acquisitionSource : undefined,
  acquisitionPrice: opts?.includeOwnerOnly ? row.acquisitionPrice : undefined,
  snapshot: row.snapshot,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
  addedAt: opts?.addedAt,
  puzzle: puzzle ? toOwnedCopyPuzzleView(puzzle) : null,
  owner:
    opts && "owner" in opts
      ? opts.owner
        ? toOwnedCopyOwnerView(opts.owner)
        : null
      : undefined,
  coverUrl: opts?.coverUrl,
});

/** A stored image row for an owned copy. */
export const toOwnedCopyImageView = (
  row: Doc<"ownedPuzzleImages">,
): OwnedCopyImageView => ({
  _id: row._id,
  _creationTime: row._creationTime,
  ownedPuzzleId: row.ownedPuzzleId,
  uploaderId: row.uploaderId,
  fileId: row.fileId,
  title: row.title,
  description: row.description,
  tag: row.tag,
  takenAt: row.takenAt,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

/** A completion record joined into the copy-detail view. */
export const toOwnedCopyCompletionView = (
  row: Doc<"completions">,
): OwnedCopyCompletionView => ({
  _id: row._id,
  _creationTime: row._creationTime,
  aggregateId: row.aggregateId,
  userId: row.userId,
  puzzleId: row.puzzleId,
  ownedPuzzleId: row.ownedPuzzleId,
  startDate: row.startDate,
  endDate: row.endDate,
  completionTimeMinutes: row.completionTimeMinutes,
  rating: row.rating,
  review: row.review,
  notes: row.notes,
  photos: row.photos,
  isCompleted: row.isCompleted,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

/** The bare collection row (no derived count) for the contains-copy read. */
export const toCollectionMembershipView = (
  row: Doc<"collections">,
): CollectionMembershipView => ({
  _id: row._id,
  _creationTime: row._creationTime,
  aggregateId: row.aggregateId,
  userId: row.userId,
  name: row.name,
  description: row.description,
  visibility: row.visibility,
  color: row.color,
  icon: row.icon,
  isDefault: row.isDefault,
  isWishlist: row.isWishlist,
  wishedDefinitions: row.wishedDefinitions,
  personalNotes: row.personalNotes,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

/** A collection plus its derived member count. */
export const toCollectionView = (
  row: Doc<"collections">,
  puzzleCount: number,
): CollectionView => ({
  ...toCollectionMembershipView(row),
  puzzleCount,
});

/** A collection plus its resolved member copies. */
export const toCollectionDetailView = (
  row: Doc<"collections">,
  puzzles: OwnedCopyView[],
): CollectionDetailView => ({
  ...toCollectionMembershipView(row),
  puzzles,
});
