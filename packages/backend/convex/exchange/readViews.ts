import type {
  ExchangeFields,
  ExchangeLoanState,
  ExchangeOwnedPuzzleView,
  ExchangePartyState,
  ExchangePuzzleView,
  ExchangeSummaryView,
  MemberView,
} from "@jigswap/contracts";
import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { copyShowsCatalogFacts } from "../catalog/definitionVisibility";
import { boxArtUrl } from "../lib/imageModeration/boxArtUrl";
import { canViewCopy } from "../library/canViewCopy";
import { effectiveCopyVisibility } from "../library/copyVisibility";
import { toCopySnapshotView } from "../library/mappers";
import { resolveCopyCoverUrl } from "../library/resolveCoverUrl";
import {
  projectTradeParty,
  tradePartyMemberView,
  type ProjectedTradeParty,
} from "./tradeParty";

// Shared row->DTO mapping for the exchange reads, so every exchange adapter emits typed view DTOs
// (faithful supersets of the joined rows) rather than leaking raw documents.

// Bound for a member's exchange lists (getUserExchanges, getExchangesByOwner,
// getExchangesByRequester): the newest this many by createdAt, plus the newest this many LIVE ones
// (see readMemberExchanges), so a heavy trader's history (each row joins both parties and both
// copies) can never push the read past Convex's per-function limits. Past the cap the oldest
// FINISHED exchanges are dropped; an open one stays listed until more than the cap are open.
export const EXCHANGE_LIST_CAP = 500;

type ExchangeStatus = Doc<"exchanges">["status"];

// Exchanges still in play: an offer to answer, a hand-over to arrange, a dispute to settle. The
// web's active counts use the same three (dashboard pulse, briefing hero). Every status must be
// classified here (the `satisfies` fails type-check otherwise), so a new in-play status can't
// silently be treated as finished and drop out of the bounded lists.
const EXCHANGE_STATUS_IS_LIVE = {
  proposed: true,
  accepted: true,
  disputed: true,
  completed: false,
  rejected: false,
  cancelled: false,
} as const satisfies Record<ExchangeStatus, boolean>;

export const LIVE_EXCHANGE_STATUSES: readonly ExchangeStatus[] = (
  Object.keys(EXCHANGE_STATUS_IS_LIVE) as ExchangeStatus[]
).filter((status) => EXCHANGE_STATUS_IS_LIVE[status]);

export const isLiveExchangeStatus = (status: ExchangeStatus): boolean =>
  EXCHANGE_STATUS_IS_LIVE[status];

/**
 * The bounded window over a member's exchanges, newest first: the newest EXCHANGE_LIST_CAP overall
 * plus the newest EXCHANGE_LIST_CAP live ones, so at most twice the cap. Rows are kept by identity,
 * so a row in both halves is listed once.
 */
export const boundedExchangeWindow = <
  R extends Pick<Doc<"exchanges">, "status" | "createdAt">,
>(
  rows: R[],
): R[] => {
  const newestFirst = [...rows].sort((a, b) => b.createdAt - a.createdAt);
  const kept = new Set<R>([
    ...newestFirst.slice(0, EXCHANGE_LIST_CAP),
    ...newestFirst
      .filter((row) => isLiveExchangeStatus(row.status))
      .slice(0, EXCHANGE_LIST_CAP),
  ]);
  return newestFirst.filter((row) => kept.has(row));
};

const exchangesInStatus = (
  ctx: QueryCtx,
  memberId: Id<"users">,
  role: "initiator" | "recipient",
  status: ExchangeStatus,
): Promise<Doc<"exchanges">[]> =>
  role === "initiator"
    ? ctx.db
        .query("exchanges")
        .withIndex("by_initiator_status_created", (q) =>
          q.eq("initiatorId", memberId).eq("status", status),
        )
        .order("desc")
        .take(EXCHANGE_LIST_CAP)
    : ctx.db
        .query("exchanges")
        .withIndex("by_recipient_status_created", (q) =>
          q.eq("recipientId", memberId).eq("status", status),
        )
        .order("desc")
        .take(EXCHANGE_LIST_CAP);

/** One role's exchanges still in play: each live status's newest EXCHANGE_LIST_CAP. */
export const readLiveExchanges = async (
  ctx: QueryCtx,
  memberId: Id<"users">,
  role: "initiator" | "recipient",
): Promise<Doc<"exchanges">[]> =>
  (
    await Promise.all(
      LIVE_EXCHANGE_STATUSES.map((status) =>
        exchangesInStatus(ctx, memberId, role, status),
      ),
    )
  ).flat();

/**
 * One role's exchanges for the member (initiator = outgoing, recipient = incoming), newest first,
 * read only through bounded index ranges. With a `status`: that status's newest EXCHANGE_LIST_CAP,
 * however old. Without: the newest EXCHANGE_LIST_CAP overall plus each live status's newest
 * EXCHANGE_LIST_CAP, cut down by boundedExchangeWindow, so an old open exchange is never pushed out
 * by newer finished ones.
 */
export const readMemberExchanges = async (
  ctx: QueryCtx,
  memberId: Id<"users">,
  role: "initiator" | "recipient",
  status?: ExchangeStatus,
): Promise<Doc<"exchanges">[]> => {
  if (status) return exchangesInStatus(ctx, memberId, role, status);

  const newest =
    role === "initiator"
      ? ctx.db
          .query("exchanges")
          .withIndex("by_initiator_created", (q) =>
            q.eq("initiatorId", memberId),
          )
          .order("desc")
          .take(EXCHANGE_LIST_CAP)
      : ctx.db
          .query("exchanges")
          .withIndex("by_recipient_created", (q) =>
            q.eq("recipientId", memberId),
          )
          .order("desc")
          .take(EXCHANGE_LIST_CAP);
  const [history, live] = await Promise.all([
    newest,
    readLiveExchanges(ctx, memberId, role),
  ]);
  const byId = new Map<Id<"exchanges">, Doc<"exchanges">>();
  for (const row of [...history, ...live]) byId.set(row._id, row);
  return boundedExchangeWindow([...byId.values()]);
};

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
    // Never the cached box-art id (SEC-01): see library/mappers toCopySnapshotView.
    snapshot: toCopySnapshotView(c.snapshot),
    ...(visible.has(c.ownerId) ? { ownerId: c.ownerId } : {}),
    condition: c.condition,
    missingPiecesCount: c.missingPiecesCount,
    // Owner-only personal fields: only surfaced when the viewer owns this copy.
    notes: viewerIsOwner ? c.notes : undefined,
    availability: c.availability,
    // The effective value, never the raw column: that holds the owner's choice, which may be
    // "private" on an offered copy and is not the counterparty's business.
    visibility: effectiveCopyVisibility(c),
    // Public asking price for a copy listed for sale — always carried.
    salePrice: c.salePrice,
    acquisitionDate: viewerIsOwner ? c.acquisitionDate : undefined,
    acquisitionSource: viewerIsOwner ? c.acquisitionSource : undefined,
    acquisitionPrice: viewerIsOwner ? c.acquisitionPrice : undefined,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
  };
};

// The catalog submitter (`submittedBy`) is never carried: it is an unrelated member's raw id. Nor is
// the box art (`image`): it is a raw `_storage` id, and a member holding one could attach it as
// their own photo and delete it (SEC-01). No exchange view renders it.
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
        searchableText: p.searchableText,
        status: p.status,
        createdAt: p.createdAt,
        updatedAt: p.updatedAt,
      }
    : null;

/**
 * The definition behind `copy` as `viewerId` sees it on an exchange. For a definition that is not
 * approved, a viewer the copy does not show catalogue facts to (catalog/definitionVisibility's
 * copyShowsCatalogFacts: anyone but the copy's owner, and the owner too unless the definition is
 * disabled or their own submission) gets only the copy's snapshot facts (title, brand, pieces; the
 * row's for a legacy copy without a snapshot) plus toPuzzleView's status and timestamps, as
 * library/mappers' toCopyPuzzleView does for every other copy view. The definition's unmoderated
 * text, identifiers and searchable text are left out, and like toPuzzleView it never carries the
 * raw box-art id (`image`, SEC-01). Approved definitions get toPuzzleView unchanged.
 */
export const toPuzzleViewFor = (
  p: Doc<"puzzles"> | null,
  copy: Doc<"ownedPuzzles"> | null,
  viewerId: Id<"users">,
): ExchangePuzzleView | null => {
  const full = toPuzzleView(p);
  if (!p || !full) return full;
  const showsFacts = copy
    ? copyShowsCatalogFacts(copy, p, copy.ownerId === viewerId)
    : p.status === "approved";
  if (showsFacts) return full;
  return {
    _id: full._id,
    _creationTime: full._creationTime,
    aggregateId: full.aggregateId,
    title: copy?.snapshot?.title ?? full.title,
    brand: copy?.snapshot?.brand ?? full.brand,
    pieceCount: copy?.snapshot?.pieceCount ?? full.pieceCount,
    status: full.status,
    createdAt: full.createdAt,
    updatedAt: full.updatedAt,
  };
};

/**
 * The loan a COMPLETED lend opened. Loans carry no exchange id, so the match is by time: settling
 * the lend schedules the loan's opening (library/openLoanOnSettlement), which makes it the FIRST
 * loan of the requested copy opened at or after the exchange settled (`updatedAt`, which no later
 * write touches while the exchange stays completed). It must also be the initiator's (the
 * borrower). Anything else is null — no loan yet, a lend settled before loans existed, or a first
 * later loan that went to someone else — so a later lend of the same copy never relabels an older
 * exchange. Both parties of the lend are the loan's parties, so it discloses nothing new.
 */
const settledLoanOf = async (
  ctx: QueryCtx,
  e: Doc<"exchanges">,
  requested: Doc<"ownedPuzzles"> | null,
): Promise<ExchangeLoanState | null> => {
  const copyId = requested?.aggregateId;
  if (!copyId) return null;
  const loan = await ctx.db
    .query("loans")
    .withIndex("by_copy", (q) =>
      q.eq("copyId", copyId).gte("openedAt", e.updatedAt),
    )
    .order("asc")
    .first();
  if (!loan || loan.borrowerId !== e.initiatorId) return null;
  return {
    status: loan.status,
    openedAt: loan.openedAt,
    expectedReturn: loan.expectedReturn,
    closedAt: loan.closedAt,
  };
};

/**
 * SECURITY: an exchange row outlives what it shows. A party of a rejected or cancelled swap, or one
 * the owner has since blocked, keeps the row and its catalogue data but may no longer open the copy.
 * A member's own cover photo is personal, so the row carries it only for a viewer the copy page
 * would show it to (`canViewCopy`, rule P and the block veto included); anyone else gets the
 * catalogue box art, or null without any. A copy with no cover photo has nothing personal to hide,
 * so it skips the check.
 */
const coverUrlForViewer = async (
  ctx: QueryCtx,
  viewerId: Id<"users">,
  copy: Doc<"ownedPuzzles"> | null,
  puzzle: Doc<"puzzles"> | null,
): Promise<string | null> => {
  if (!copy) return null;
  if (copy.coverImageId && !(await canViewCopy(ctx, viewerId, copy))) {
    return boxArtUrl(ctx, puzzle?.image);
  }
  return resolveCopyCoverUrl(ctx, copy, puzzle);
};

// Enrich one exchange row into a list-item view: project both parties (projectExchangeParties), the
// requested/offered owned copies, their catalog definitions (copy.puzzleId -> puzzles), their card
// covers and, for a completed lend, the loan it opened. Mirrors the legacy two-step join in
// getUserExchanges/getExchangesByOwner/getExchangesByRequester. `userRole` is set by the caller.
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
  // Each side's card cover, as a URL, gated per copy and per viewer (coverUrlForViewer).
  const [requestedCoverUrl, offeredCoverUrl] = await Promise.all([
    coverUrlForViewer(ctx, viewerId, requestedOwnedPuzzle, requestedPuzzle),
    coverUrlForViewer(ctx, viewerId, offeredOwnedPuzzle, offeredPuzzle),
  ]);
  // A settled lend reads "completed" while the puzzle is still out: carry the loan it opened.
  const settledLend = e.type === "loan" && e.status === "completed";

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
    requestedPuzzle: toPuzzleViewFor(
      requestedPuzzle,
      requestedOwnedPuzzle,
      viewerId,
    ),
    offeredOwnedPuzzle: toOwnedPuzzleView(
      offeredOwnedPuzzle,
      viewerId,
      parties.visible,
    ),
    offeredPuzzle: toPuzzleViewFor(offeredPuzzle, offeredOwnedPuzzle, viewerId),
    requestedCoverUrl,
    offeredCoverUrl,
    ...(settledLend
      ? { loan: await settledLoanOf(ctx, e, requestedOwnedPuzzle) }
      : {}),
  };
};
