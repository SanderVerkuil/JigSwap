import type {
  ExchangeFields,
  ExchangeOwnedPuzzleView,
  ExchangePuzzleView,
  ExchangeSummaryView,
  MemberView,
} from "@jigswap/contracts";
import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { projectMemberIdentity } from "../social/privacy";

// Shared row->DTO mapping for the exchange reads, so every exchange adapter emits typed view DTOs
// (faithful supersets of the joined rows) rather than leaking raw documents.

/**
 * Both parties as the viewer may see them. Each party goes through the privacy chokepoint
 * (projectMemberIdentity, salt = the exchange `_id`): a party anonymous to the viewer becomes
 * `null` and is flagged hidden, so every view also OMITS their raw id (a raw user id is itself a
 * leak — e.g. a locked profile hero discloses name/avatar to anyone holding it). The owner is
 * revealed to the requester only once the owner acted (social/identityRevealSubscriber).
 */
export type ExchangeParties = {
  readonly requester: MemberView | null;
  readonly owner: MemberView | null;
  /** Party ids the viewer may NOT see (never contains the viewer). */
  readonly hidden: ReadonlySet<Id<"users">>;
};

export const projectExchangeParties = async (
  ctx: QueryCtx,
  e: Doc<"exchanges">,
  viewerId: Id<"users">,
): Promise<ExchangeParties> => {
  const salt = e._id as string;
  const [requester, owner] = await Promise.all([
    projectMemberIdentity(ctx, viewerId, e.initiatorId, salt),
    projectMemberIdentity(ctx, viewerId, e.recipientId, salt),
  ]);
  const hidden = new Set<Id<"users">>();
  if (requester.anonymous && e.initiatorId !== viewerId) {
    hidden.add(e.initiatorId);
  }
  if (owner.anonymous && e.recipientId !== viewerId) hidden.add(e.recipientId);
  return {
    requester: requester.anonymous ? null : requester.member,
    owner: owner.anonymous ? null : owner.member,
    hidden,
  };
};

export const toExchangeFields = (
  e: Doc<"exchanges">,
  hidden: ReadonlySet<Id<"users">>,
): ExchangeFields => ({
  _id: e._id,
  _creationTime: e._creationTime,
  aggregateId: e.aggregateId,
  ...(hidden.has(e.initiatorId) ? {} : { initiatorId: e.initiatorId }),
  ...(hidden.has(e.recipientId) ? {} : { recipientId: e.recipientId }),
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

/**
 * SECURITY: an exchange shows BOTH parties two owned copies (the requested copy owned by the
 * recipient, the offered copy owned by the initiator) to BOTH parties. The owner-only personal
 * fields — `notes` and the acquisition provenance (`acquisitionDate` / `acquisitionSource` /
 * `acquisitionPrice`, i.e. where/when/what-was-paid) — must never cross to the counterparty, so they
 * are OMITTED unless `viewerId` owns THIS specific copy (`c.ownerId === viewerId`). Mirrors
 * `library/mappers.ts` `toOwnedCopyView` and `getCopyInstanceView`. `salePrice` is NOT owner-only:
 * it is the public asking price for a copy listed for sale (and intrinsic to the exchange), so it is
 * always carried. Each copy is gated independently — pass the acting member as `viewerId`.
 * `ownerId` is OMITTED when the copy's owner is in `hidden` (a party anonymous to the viewer).
 */
export const toOwnedPuzzleView = (
  c: Doc<"ownedPuzzles"> | null,
  viewerId: Id<"users">,
  hidden: ReadonlySet<Id<"users">>,
): ExchangeOwnedPuzzleView | null => {
  if (!c) return null;
  const viewerIsOwner = c.ownerId === viewerId;
  return {
    _id: c._id,
    _creationTime: c._creationTime,
    aggregateId: c.aggregateId,
    puzzleId: c.puzzleId,
    puzzleDefinitionId: c.puzzleDefinitionId,
    snapshot: c.snapshot,
    ...(hidden.has(c.ownerId) ? {} : { ownerId: c.ownerId }),
    condition: c.condition,
    missingPiecesCount: c.missingPiecesCount,
    // Owner-only personal fields: only surfaced when the viewer owns this copy.
    notes: viewerIsOwner ? c.notes : undefined,
    availability: c.availability,
    visibility: c.visibility,
    // Public asking price for a copy listed for sale — always carried.
    salePrice: c.salePrice,
    acquisitionDate: viewerIsOwner ? c.acquisitionDate : undefined,
    acquisitionSource: viewerIsOwner ? c.acquisitionSource : undefined,
    acquisitionPrice: viewerIsOwner ? c.acquisitionPrice : undefined,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
  };
};

// `submittedBy` is OMITTED when the catalog submitter is a party anonymous to the viewer (the owner
// often submitted the definition of the copy they own).
export const toPuzzleView = (
  p: Doc<"puzzles"> | null,
  hidden: ReadonlySet<Id<"users">>,
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
        ...(hidden.has(p.submittedBy) ? {} : { submittedBy: p.submittedBy }),
        createdAt: p.createdAt,
        updatedAt: p.updatedAt,
      }
    : null;

// Enrich one exchange row into a list-item view: project both parties (projectExchangeParties), the
// requested/offered owned copies and their catalog definitions (copy.puzzleId -> puzzles). Mirrors
// the legacy two-step join in getUserExchanges/getExchangesByOwner/getExchangesByRequester.
// `userRole` is set by the caller.
export const enrichExchangeSummary = async (
  ctx: QueryCtx,
  e: Doc<"exchanges">,
  viewerId: Id<"users">,
  userRole?: "requester" | "owner",
): Promise<ExchangeSummaryView> => {
  const [parties, requestedOwnedPuzzle, offeredOwnedPuzzle] = await Promise.all(
    [
      projectExchangeParties(ctx, e, viewerId),
      ctx.db.get(e.requestedPuzzleId),
      e.offeredPuzzleId ? ctx.db.get(e.offeredPuzzleId) : null,
    ],
  );

  const [requestedPuzzle, offeredPuzzle] = await Promise.all([
    requestedOwnedPuzzle ? ctx.db.get(requestedOwnedPuzzle.puzzleId) : null,
    offeredOwnedPuzzle ? ctx.db.get(offeredOwnedPuzzle.puzzleId) : null,
  ]);

  return {
    ...toExchangeFields(e, parties.hidden),
    ...(userRole ? { userRole } : {}),
    requester: parties.requester,
    owner: parties.owner,
    // Gate each copy independently: the viewer sees owner-only fields only on the copy they own.
    requestedOwnedPuzzle: toOwnedPuzzleView(
      requestedOwnedPuzzle,
      viewerId,
      parties.hidden,
    ),
    requestedPuzzle: toPuzzleView(requestedPuzzle, parties.hidden),
    offeredOwnedPuzzle: toOwnedPuzzleView(
      offeredOwnedPuzzle,
      viewerId,
      parties.hidden,
    ),
    offeredPuzzle: toPuzzleView(offeredPuzzle, parties.hidden),
  };
};
