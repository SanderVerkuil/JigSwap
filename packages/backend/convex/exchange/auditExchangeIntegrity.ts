import { canStillSettle } from "@jigswap/domain";
import { paginationOptsValidator, type PaginationOptions } from "convex/server";
import type { Doc, Id } from "../_generated/dataModel";
import { internalQuery, type QueryCtx } from "../_generated/server";
import { convexCopyPort } from "./adapters/convexCopyPort";
import { toDomain } from "./adapters/mapper";

// Read-only integrity audit for "one copy, one deal" (SEC-02, SEC-36; P-02 item 10). Before P-02 a
// stale exchange could still settle, several deals could be accepted on one copy and a copy could be
// lent out twice; the guards now stop new cases, but stored data may hold old ones. Each function
// pages ONE table by cursor and returns only findings (ids, never names or emails), so an operator
// can triage them with the members involved. INTERNAL ONLY: never in the gateway, writes nothing.
//
// Run each until isDone, passing the returned continueCursor back in (documentation only; never
// against a shared deployment from an agent session):
//   npx convex run --prod exchange/auditExchangeIntegrity:settlementsByNonParty \
//     '{"paginationOpts":{"numItems":100,"cursor":null}}'
// and likewise acceptedDealConflicts, loanConflicts and possessionWithoutLoan.

// A page reads 1 to MAX_PAGE_SIZE rows of its table, whatever is asked, plus a few indexed reads per
// row, so it stays inside the query read limits.
const MAX_PAGE_SIZE = 100;
const clamped = (opts: PaginationOptions): PaginationOptions => ({
  ...opts,
  numItems: Math.min(MAX_PAGE_SIZE, Math.max(1, Math.floor(opts.numItems))),
});

/* ---------------------------------------------------- settlements by a non-party */

// reason:
//   requestedNotFromRecipient   the requested copy moved out of someone other than the recipient;
//   offeredNotFromRecordedOwner the offered copy moved out of someone other than its recorded owner;
//   offeredNotFromInitiator     an older swap (no recorded owner): it moved out of someone other
//                               than the initiator. It may be a housemate's copy the initiator
//                               co-managed, so check it by hand;
//   exchangeMissing             no exchange has the custody row's exchangeId;
//   copyNotInExchange           the exchange names the copy as neither requested nor offered.
export type SettlementFinding = {
  reason:
    | "requestedNotFromRecipient"
    | "offeredNotFromRecordedOwner"
    | "offeredNotFromInitiator"
    | "exchangeMissing"
    | "copyNotInExchange";
  custodyEntryId: Id<"copyCustodyEntries">;
  copyId: string;
  exchangeId: string;
  previousOwner: string;
  newOwner: string;
  expectedPreviousOwner?: Id<"users">;
  occurredAt: number;
};

// Every ownership transfer (one copyCustodyEntries row each, written as the copy moved) whose
// previous owner was not the member the settling deal was made with: the recipient for the
// requested copy; for a swap's offered copy, the owner recorded at propose time, else (older swaps)
// the initiator.
export const settlementsByNonParty = internalQuery({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, { paginationOpts }) => {
    const page = await ctx.db
      .query("copyCustodyEntries")
      .paginate(clamped(paginationOpts));
    const findings: SettlementFinding[] = [];
    for (const entry of page.page) {
      const finding = await settlementFindingOf(ctx, entry);
      if (finding) findings.push(finding);
    }
    return {
      scanned: page.page.length,
      findings,
      isDone: page.isDone,
      continueCursor: page.continueCursor,
    };
  },
});

const settlementFindingOf = async (
  ctx: QueryCtx,
  entry: Doc<"copyCustodyEntries">,
): Promise<SettlementFinding | null> => {
  const base = {
    custodyEntryId: entry._id,
    copyId: entry.copyId,
    exchangeId: entry.exchangeId,
    previousOwner: entry.previousOwner,
    newOwner: entry.newOwner,
    occurredAt: entry.occurredAt,
  };
  const exchange = await ctx.db
    .query("exchanges")
    .withIndex("by_aggregate_id", (q) => q.eq("aggregateId", entry.exchangeId))
    .first();
  if (!exchange) return { ...base, reason: "exchangeMissing" };
  const expected = expectedPreviousOwnerOf(exchange, entry.copyId);
  if (!expected) return { ...base, reason: "copyNotInExchange" };
  if (entry.previousOwner === expected.owner) return null;
  return {
    ...base,
    reason: expected.reason,
    expectedPreviousOwner: expected.owner,
  };
};

const expectedPreviousOwnerOf = (
  exchange: Doc<"exchanges">,
  copyId: string,
): { owner: Id<"users">; reason: SettlementFinding["reason"] } | null => {
  if (exchange.requestedPuzzleId === copyId) {
    return { owner: exchange.recipientId, reason: "requestedNotFromRecipient" };
  }
  if (exchange.offeredPuzzleId === copyId) {
    return exchange.offeredPuzzleOwnerId === undefined
      ? { owner: exchange.initiatorId, reason: "offeredNotFromInitiator" }
      : {
          owner: exchange.offeredPuzzleOwnerId,
          reason: "offeredNotFromRecordedOwner",
        };
  }
  return null;
};

/* ------------------------------------------- copies with several accepted deals */

export type AcceptedDealConflict = {
  copyId: Id<"ownedPuzzles">;
  // Oldest first. canStillSettle is the settlement guard's verdict now: a deal that can't settle
  // any more (a copy changed hands, is gone or is out on loan) holds nothing, but stays accepted.
  exchanges: { exchangeId: string; canStillSettle: boolean }[];
};

// Every copy that more than one ACCEPTED exchange would move (as requested copy, or as a swap's
// offered copy). Accept now refuses while another accepted deal on the copy can still settle, so
// these predate that rule. Each copy is reported once, from its oldest accepted exchange. Rows
// without an aggregateId can't be acted on and are left out, as in the reservation checks.
export const acceptedDealConflicts = internalQuery({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, { paginationOpts }) => {
    const page = await ctx.db
      .query("exchanges")
      .paginate(clamped(paginationOpts));
    const stillSettles = canStillSettle(convexCopyPort(ctx));
    const conflicts: AcceptedDealConflict[] = [];
    for (const row of page.page) {
      if (!isActionableAccepted(row)) continue;
      for (const copyId of copiesMovedBy(row)) {
        const accepted = await acceptedMoving(ctx, copyId);
        if (accepted.length < 2 || accepted[0]._id !== row._id) continue;
        conflicts.push({
          copyId,
          exchanges: await Promise.all(
            accepted.map(async (other) => ({
              exchangeId: other.aggregateId as string,
              canStillSettle: await stillSettles(toDomain(other)),
            })),
          ),
        });
      }
    }
    return {
      scanned: page.page.length,
      conflicts,
      isDone: page.isDone,
      continueCursor: page.continueCursor,
    };
  },
});

const isActionableAccepted = (row: Doc<"exchanges">): boolean =>
  row.status === "accepted" && row.aggregateId !== undefined;

// The copies settlement would move, as Exchange.settle does: the requested copy, plus a swap's
// offered copy.
const copiesMovedBy = (row: Doc<"exchanges">): Id<"ownedPuzzles">[] =>
  row.type === "trade" && row.offeredPuzzleId
    ? [row.requestedPuzzleId, row.offeredPuzzleId]
    : [row.requestedPuzzleId];

// The actionable accepted exchanges that would move the copy, oldest first.
const acceptedMoving = async (
  ctx: QueryCtx,
  copyId: Id<"ownedPuzzles">,
): Promise<Doc<"exchanges">[]> => {
  const [asRequested, asOffered] = await Promise.all([
    ctx.db
      .query("exchanges")
      .withIndex("by_requested_copy", (q) => q.eq("requestedPuzzleId", copyId))
      .collect(),
    ctx.db
      .query("exchanges")
      .withIndex("by_offered_copy", (q) => q.eq("offeredPuzzleId", copyId))
      .collect(),
  ]);
  const byId = new Map<Id<"exchanges">, Doc<"exchanges">>();
  for (const row of [
    ...asRequested,
    ...asOffered.filter((r) => r.type === "trade"),
  ]) {
    if (isActionableAccepted(row)) byId.set(row._id, row);
  }
  return [...byId.values()].sort(
    (a, b) => a._creationTime - b._creationTime || (a._id < b._id ? -1 : 1),
  );
};

/* ----------------------------------------------------------------- open loans */

// reasons:
//   copyMissing        no copy has the loan's copyId;
//   borrowerNotHolding the copy is at the owner's or someone else's, not the borrower's;
//   lenderNotOwner     left open by a former owner (a transfer before transfers ended loans);
//   multipleOpenLoans  the copy has more than one open loan.
export type LoanFinding = {
  loanRowId: Id<"loans">;
  loanId?: string;
  copyId: string;
  lenderId: Id<"users">;
  borrowerId: Id<"users">;
  ownerId?: Id<"users">;
  heldBy?: Id<"users">;
  openLoansOnCopy: number;
  reasons: (
    | "copyMissing"
    | "borrowerNotHolding"
    | "lenderNotOwner"
    | "multipleOpenLoans"
  )[];
  openedAt: number;
};

// Every open loan that disagrees with its copy: the borrower doesn't hold it, the lender no longer
// owns it, or another loan on the same copy is open too. One open loan per copy, held by its
// borrower, is the invariant the loan use cases now keep.
export const loanConflicts = internalQuery({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, { paginationOpts }) => {
    const page = await ctx.db.query("loans").paginate(clamped(paginationOpts));
    const findings: LoanFinding[] = [];
    for (const loan of page.page) {
      if (loan.status !== "open") continue;
      const finding = await loanFindingOf(ctx, loan);
      if (finding) findings.push(finding);
    }
    return {
      scanned: page.page.length,
      findings,
      isDone: page.isDone,
      continueCursor: page.continueCursor,
    };
  },
});

const loanFindingOf = async (
  ctx: QueryCtx,
  loan: Doc<"loans">,
): Promise<LoanFinding | null> => {
  // Loans name the copy by its aggregateId; a copy's loans are few.
  const [copy, openLoans] = await Promise.all([
    ctx.db
      .query("ownedPuzzles")
      .withIndex("by_aggregate_id", (q) => q.eq("aggregateId", loan.copyId))
      .first(),
    ctx.db
      .query("loans")
      .withIndex("by_copy", (q) => q.eq("copyId", loan.copyId))
      .filter((q) => q.eq(q.field("status"), "open"))
      .collect(),
  ]);
  const reasons: LoanFinding["reasons"] = [];
  if (!copy) {
    reasons.push("copyMissing");
  } else {
    if ((copy.heldBy ?? copy.ownerId) !== loan.borrowerId) {
      reasons.push("borrowerNotHolding");
    }
    if (loan.lenderId !== copy.ownerId) reasons.push("lenderNotOwner");
  }
  if (openLoans.length > 1) reasons.push("multipleOpenLoans");
  if (reasons.length === 0) return null;
  return {
    loanRowId: loan._id,
    loanId: loan.aggregateId,
    copyId: loan.copyId,
    lenderId: loan.lenderId,
    borrowerId: loan.borrowerId,
    ownerId: copy?.ownerId,
    heldBy: copy?.heldBy,
    openLoansOnCopy: openLoans.length,
    reasons,
    openedAt: loan.openedAt,
  };
};

/* ---------------------------------------------------- possession without a loan */

export type PossessionFinding = {
  copyId: Id<"ownedPuzzles">;
  aggregateId?: string;
  ownerId: Id<"users">;
  heldBy: Id<"users">;
};

// Every copy recorded at someone else's (heldBy is not the owner) with no open loan to that member.
// Such a copy reads as out on loan (it can't be offered, lent, asked for or settle) yet there is no
// loan to return or recall, so the owner could never get it back on the market.
export const possessionWithoutLoan = internalQuery({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, { paginationOpts }) => {
    const page = await ctx.db
      .query("ownedPuzzles")
      .paginate(clamped(paginationOpts));
    const findings: PossessionFinding[] = [];
    for (const copy of page.page) {
      const heldBy = copy.heldBy;
      if (heldBy === undefined || heldBy === copy.ownerId) continue;
      const aggregateId = copy.aggregateId;
      const loan =
        aggregateId === undefined
          ? null
          : await ctx.db
              .query("loans")
              .withIndex("by_copy", (q) => q.eq("copyId", aggregateId))
              .filter((q) =>
                q.and(
                  q.eq(q.field("status"), "open"),
                  q.eq(q.field("borrowerId"), heldBy),
                ),
              )
              .first();
      if (!loan) {
        findings.push({
          copyId: copy._id,
          aggregateId,
          ownerId: copy.ownerId,
          heldBy,
        });
      }
    }
    return {
      scanned: page.page.length,
      findings,
      isDone: page.isDone,
      continueCursor: page.continueCursor,
    };
  },
});
