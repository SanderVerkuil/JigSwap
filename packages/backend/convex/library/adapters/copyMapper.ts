import {
  Acquisition,
  CatalogSnapshot,
  Copy,
  CopyImage,
  type CopyState,
  type OwnerId,
  Price,
  SharingSetting,
  toId,
} from "@jigswap/domain";
import type { Doc, Id } from "../../_generated/dataModel";

// ACL between the persisted `ownedPuzzles` (+ `ownedPuzzleImages`) rows and the Copy aggregate.
// Schema shape stops here and never ripples into the domain.

// The insert/patch payload for the copy row (minus Convex-managed `_id`/`_creationTime`). The
// legacy `puzzleId` FK is excluded here because the mapper is pure and cannot resolve the real
// `puzzles._id` from the Catalog aggregateId — the repository resolves and supplies it.
export type OwnedPuzzleRow = Omit<
  Doc<"ownedPuzzles">,
  "_id" | "_creationTime" | "puzzleId"
>;

// An image VO -> the `ownedPuzzleImages` insert payload (the repository owns uploaderId/timestamps).
export const imageToVo = (row: Doc<"ownedPuzzleImages">): CopyImage =>
  CopyImage.create({
    fileId: toId<"FileId">(row.fileId as unknown as string),
    title: row.title,
    description: row.description,
    tag: row.tag,
    takenAt: row.takenAt === undefined ? undefined : new Date(row.takenAt),
  });

// Row + its loaded images -> aggregate. The row MUST carry an aggregateId (only domain-written
// rows do); callers guard for it before mapping.
export const toDomain = (
  row: Doc<"ownedPuzzles">,
  images: readonly Doc<"ownedPuzzleImages">[],
): Copy => {
  // The Catalog reference: prefer the new puzzleDefinitionId column, falling back to the legacy
  // puzzleId so a backfilled-then-acquired round-trip stays consistent.
  const puzzleDefinitionId = toId<"PuzzleDefinitionId">(
    (row.puzzleDefinitionId ?? (row.puzzleId as unknown as string)) as string,
  );
  const snapshot = CatalogSnapshot.create({
    puzzleDefinitionId,
    title: row.snapshot?.title ?? "",
    pieceCount: row.snapshot?.pieceCount ?? 0,
    brand: row.snapshot?.brand,
    thumbnail: row.snapshot?.thumbnail,
  });

  const salePrice = row.salePrice
    ? Price.fromState(row.salePrice.amount, row.salePrice.currency)
    : undefined;
  const acquisitionPrice = row.acquisitionPrice
    ? Price.fromState(row.acquisitionPrice.amount, row.acquisitionPrice.currency)
    : undefined;

  const state: CopyState = {
    id: toId<"CopyId">(row.aggregateId as string),
    ownerId: toId<"OwnerId">(row.ownerId as unknown as string) as OwnerId,
    // Legacy/unset heldBy means the owner holds it.
    heldBy: toId<"OwnerId">(
      (row.heldBy ?? row.ownerId) as unknown as string,
    ) as OwnerId,
    puzzleDefinitionId,
    snapshot,
    condition: row.condition,
    missingPiecesCount: row.missingPiecesCount,
    notes: row.notes,
    sharing: sharingFromRow(row, salePrice),
    acquisition: Acquisition.create({
      date:
        row.acquisitionDate === undefined
          ? undefined
          : new Date(row.acquisitionDate),
      source: row.acquisitionSource,
      price: acquisitionPrice,
    }),
    images: images.map(imageToVo),
    createdAt: new Date(row.createdAt),
    updatedAt: new Date(row.updatedAt),
  };
  return Copy.rehydrate(state);
};

// Aggregate -> copy row payload (without the legacy `puzzleId` FK, which the repository fills
// with the resolved real `puzzles._id`). Images are persisted separately by the repository
// (they live in `ownedPuzzleImages`).
export const toRow = (copy: Copy): OwnedPuzzleRow => {
  const state: CopyState = copy.toState();
  const sharing = state.sharing;
  return {
    aggregateId: state.id as string,
    puzzleDefinitionId: state.puzzleDefinitionId as string,
    snapshot: {
      title: state.snapshot.title,
      brand: state.snapshot.brand,
      pieceCount: state.snapshot.pieceCount,
      thumbnail: state.snapshot.thumbnail,
    },
    ownerId: state.ownerId as unknown as Id<"users">,
    heldBy: state.heldBy as unknown as Id<"users">,
    condition: state.condition,
    missingPiecesCount: state.missingPiecesCount,
    notes: state.notes,
    availability: {
      forTrade: sharing.forTrade,
      forSale: sharing.forSale,
      forLend: sharing.forLend,
    },
    visibility: sharing.visibility,
    salePrice: sharing.salePrice
      ? { amount: sharing.salePrice.amountCents, currency: sharing.salePrice.currency }
      : undefined,
    acquisitionDate: state.acquisition.date?.getTime(),
    acquisitionSource: state.acquisition.source,
    acquisitionPrice: state.acquisition.price
      ? {
          amount: state.acquisition.price.amountCents,
          currency: state.acquisition.price.currency,
        }
      : undefined,
    createdAt: state.createdAt.getTime(),
    updatedAt: state.updatedAt.getTime(),
  };
};

// The SharingSetting consolidates the availability flags + a (new, optional) visibility column.
// Legacy rows lack the visibility column; default them to "private" (not publicly visible) so a
// pre-domain copy is never silently exposed.
const sharingFromRow = (
  row: Doc<"ownedPuzzles">,
  salePrice: Price | undefined,
): SharingSetting =>
  SharingSetting.create({
    visibility: row.visibility ?? "private",
    forTrade: row.availability.forTrade,
    forSale: row.availability.forSale,
    forLend: row.availability.forLend,
    salePrice,
  });
