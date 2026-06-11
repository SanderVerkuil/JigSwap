import type {
  ExchangeFields,
  ExchangeOwnedPuzzleView,
  ExchangePuzzleView,
  ExchangeSummaryView,
} from "@jigswap/contracts";
import type { Doc } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { toMemberView } from "../identity/toMemberView";

// Shared row->DTO mapping for the exchange reads, so every exchange adapter emits typed view DTOs
// (faithful supersets of the joined rows) rather than leaking raw documents.

export const toExchangeFields = (e: Doc<"exchanges">): ExchangeFields => ({
  _id: e._id,
  _creationTime: e._creationTime,
  aggregateId: e.aggregateId,
  initiatorId: e.initiatorId,
  recipientId: e.recipientId,
  type: e.type,
  offeredPuzzleId: e.offeredPuzzleId,
  requestedPuzzleId: e.requestedPuzzleId,
  salePrice: e.salePrice,
  loanReturnDate: e.loanReturnDate,
  status: e.status,
  initiatorConfirmationTimestamp: e.initiatorConfirmationTimestamp,
  recipientConfirmationTimestamp: e.recipientConfirmationTimestamp,
  createdAt: e.createdAt,
  updatedAt: e.updatedAt,
});

export const toOwnedPuzzleView = (
  c: Doc<"ownedPuzzles"> | null,
): ExchangeOwnedPuzzleView | null =>
  c
    ? {
        _id: c._id,
        _creationTime: c._creationTime,
        aggregateId: c.aggregateId,
        puzzleId: c.puzzleId,
        puzzleDefinitionId: c.puzzleDefinitionId,
        snapshot: c.snapshot,
        ownerId: c.ownerId,
        condition: c.condition,
        missingPiecesCount: c.missingPiecesCount,
        notes: c.notes,
        availability: c.availability,
        visibility: c.visibility,
        salePrice: c.salePrice,
        acquisitionDate: c.acquisitionDate,
        acquisitionSource: c.acquisitionSource,
        acquisitionPrice: c.acquisitionPrice,
        createdAt: c.createdAt,
        updatedAt: c.updatedAt,
      }
    : null;

export const toPuzzleView = (
  p: Doc<"puzzles"> | null,
): ExchangePuzzleView | null =>
  p
    ? {
        _id: p._id,
        _creationTime: p._creationTime,
        aggregateId: p.aggregateId,
        title: p.title,
        description: p.description,
        brand: p.brand,
        pieceCount: p.pieceCount,
        artist: p.artist,
        series: p.series,
        ean: p.ean,
        upc: p.upc,
        modelNumber: p.modelNumber,
        dimensions: p.dimensions,
        shape: p.shape,
        difficulty: p.difficulty,
        category: p.category,
        tags: p.tags,
        image: p.image,
        searchableText: p.searchableText,
        status: p.status,
        submittedBy: p.submittedBy,
        createdAt: p.createdAt,
        updatedAt: p.updatedAt,
      }
    : null;

// Enrich one exchange row into a list-item view: resolve both parties, the requested/offered owned
// copies and their catalog definitions (copy.puzzleId -> puzzles). Mirrors the legacy two-step join
// in getUserExchanges/getExchangesByOwner/getExchangesByRequester. `userRole` is set by the caller.
export const enrichExchangeSummary = async (
  ctx: QueryCtx,
  e: Doc<"exchanges">,
  userRole?: "requester" | "owner",
): Promise<ExchangeSummaryView> => {
  const [requester, owner, requestedOwnedPuzzle, offeredOwnedPuzzle] =
    await Promise.all([
      ctx.db.get(e.initiatorId),
      ctx.db.get(e.recipientId),
      ctx.db.get(e.requestedPuzzleId),
      e.offeredPuzzleId ? ctx.db.get(e.offeredPuzzleId) : null,
    ]);

  const [requestedPuzzle, offeredPuzzle] = await Promise.all([
    requestedOwnedPuzzle ? ctx.db.get(requestedOwnedPuzzle.puzzleId) : null,
    offeredOwnedPuzzle ? ctx.db.get(offeredOwnedPuzzle.puzzleId) : null,
  ]);

  return {
    ...toExchangeFields(e),
    ...(userRole ? { userRole } : {}),
    requester: requester ? toMemberView(requester) : null,
    owner: owner ? toMemberView(owner) : null,
    requestedOwnedPuzzle: toOwnedPuzzleView(requestedOwnedPuzzle),
    requestedPuzzle: toPuzzleView(requestedPuzzle),
    offeredOwnedPuzzle: toOwnedPuzzleView(offeredOwnedPuzzle),
    offeredPuzzle: toPuzzleView(offeredPuzzle),
  };
};
