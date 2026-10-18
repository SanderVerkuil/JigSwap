import type {
  ExchangeFields,
  ExchangeOwnedPuzzleView,
  ExchangePartyState,
  ExchangePuzzleView,
  ExchangeSummaryView,
  MemberView,
} from "@jigswap/contracts";
import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import {
  projectTradeParty,
  tradePartyMemberView,
  type ProjectedTradeParty,
} from "./tradeParty";

// Shared row->DTO mapping for the exchange reads, so every exchange adapter emits typed view DTOs
// (faithful supersets of the joined rows) rather than leaking raw documents.

/**
 * Both parties as the viewer may see them inside THIS exchange, via the per-trade chokepoint
 * (exchange/tradeParty): a visible party (self, public, mutual) gets the full MemberView; a party
 * revealed only by the trade gets the TRIMMED view (no avatar/bio/location); a hidden or departed
 * party is `null`. A hidden party is also flagged so every view OMITS their raw id (a raw user id is
 * itself a leak — e.g. a locked profile hero discloses name/avatar to anyone holding it). A departed
 * party keeps their id (the account is gone; nothing private is behind it).
 */
export type ExchangeParties = {
  readonly requester: MemberView | null;
  readonly owner: MemberView | null;
  readonly requesterState: ExchangePartyState;
  readonly ownerState: ExchangePartyState;
  /** Party ids the viewer may NOT see (never contains the viewer). */
  readonly hidden: ReadonlySet<Id<"users">>;
  /**
   * Party ids the viewer MAY see (the parties not in `hidden`). Anyone outside it — a hidden party,
   * or a non-party such as a household mate whose copy was offered — never has their id emitted.
   */
  readonly visible: ReadonlySet<Id<"users">>;
};

// The contract has no "self": the viewer's own party is simply visible.
const contractStateOf = (party: ProjectedTradeParty): ExchangePartyState =>
  party.state === "self" ? "visible" : party.state;

export const projectExchangeParties = async (
  ctx: QueryCtx,
  e: Doc<"exchanges">,
  viewerId: Id<"users">,
): Promise<ExchangeParties> => {
  const [requester, owner] = await Promise.all([
    projectTradeParty(ctx, viewerId, e, e.initiatorId),
    projectTradeParty(ctx, viewerId, e, e.recipientId),
  ]);
  const hidden = new Set<Id<"users">>();
  if (requester.state === "hidden") hidden.add(e.initiatorId);
  if (owner.state === "hidden") hidden.add(e.recipientId);
  const visible = new Set(
    [e.initiatorId, e.recipientId].filter((id) => !hidden.has(id)),
  );
  return {
    requester: tradePartyMemberView(requester),
    owner: tradePartyMemberView(owner),
    requesterState: contractStateOf(requester),
    ownerState: contractStateOf(owner),
    hidden,
    visible,
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
 * `ownerId` is emitted ONLY when the copy's owner is in `visible` (a party the viewer may see): it
 * is omitted for a party anonymous to the viewer AND for a non-party owner (a requester may offer a
 * household mate's co-managed copy; the mate takes no part in the trade).
 */
export const toOwnedPuzzleView = (
  c: Doc<"ownedPuzzles"> | null,
  viewerId: Id<"users">,
  visible: ReadonlySet<Id<"users">>,
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
    ...(visible.has(c.ownerId) ? { ownerId: c.ownerId } : {}),
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

// The catalog submitter (`submittedBy`) is never carried: it is an unrelated member's raw id.
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
    requesterState: parties.requesterState,
    ownerState: parties.ownerState,
    // Gate each copy independently: the viewer sees owner-only fields only on the copy they own.
    requestedOwnedPuzzle: toOwnedPuzzleView(
      requestedOwnedPuzzle,
      viewerId,
      parties.visible,
    ),
    requestedPuzzle: toPuzzleView(requestedPuzzle),
    offeredOwnedPuzzle: toOwnedPuzzleView(
      offeredOwnedPuzzle,
      viewerId,
      parties.visible,
    ),
    offeredPuzzle: toPuzzleView(offeredPuzzle),
  };
};
