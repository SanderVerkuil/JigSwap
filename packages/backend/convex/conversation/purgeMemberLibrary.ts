import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

// Phase bodies of the account-deletion purge (conversation/purgeMemberMessagingData) for what the
// member left outside messaging: their open trades and loans. Each takes one page of the member's
// rows and returns the page, so runPhase keeps the one-phase-per-run, cursor-reschedule contract.

type PageOpts = { cursor: string | null; numItems: number };
type Page = { isDone: boolean; continueCursor: string };

// An exchange still in flight: it reserves its copies (library/adapters/convexCopyReservationPort).
// "disputed" is terminal in the Exchange state machine and can follow a completed settlement (the
// copies already moved), so it is trade history and stays, like completed/rejected/cancelled.
const OPEN_EXCHANGE = new Set(["proposed", "accepted"]);

/**
 * Cancel the member's open exchanges on one side (they proposed it, or it was proposed to them).
 * Written directly, not through the Exchange aggregate: its cancel is the initiator's move and its
 * decline the recipient's, and neither fits a deletion. Nothing is announced (no event, so no
 * notification or thread message), like the rest of this purge; the row keeps both parties and
 * reads as cancelled for the other party.
 */
export const cancelOpenExchanges = async (
  ctx: MutationCtx,
  memberId: Id<"users">,
  side: "initiator" | "recipient",
  opts: PageOpts,
): Promise<Page> => {
  const page = await (
    side === "initiator"
      ? ctx.db
          .query("exchanges")
          .withIndex("by_initiator", (q) => q.eq("initiatorId", memberId))
      : ctx.db
          .query("exchanges")
          .withIndex("by_recipient", (q) => q.eq("recipientId", memberId))
  ).paginate(opts);
  const now = Date.now();
  for (const row of page.page) {
    if (!OPEN_EXCHANGE.has(row.status)) continue;
    await ctx.db.patch(row._id, { status: "cancelled", updatedAt: now });
  }
  return page;
};

/**
 * Close the member's open loans on one side (they lent the copy, or borrowed it) as returned, and
 * give the copy back to its owner (`heldBy` cleared: an unset holder is the owner). Written
 * directly: the Loan aggregate's returnByBorrower/recallByOwner are the parties' own moves. The
 * loan row stays as the copy's history. A copy the member lent is deleted by the copies phase.
 */
export const closeOpenLoans = async (
  ctx: MutationCtx,
  memberId: Id<"users">,
  side: "lender" | "borrower",
  opts: PageOpts,
): Promise<Page> => {
  const page = await (
    side === "lender"
      ? ctx.db
          .query("loans")
          .withIndex("by_lender", (q) =>
            q.eq("lenderId", memberId).eq("status", "open"),
          )
      : ctx.db
          .query("loans")
          .withIndex("by_borrower", (q) =>
            q.eq("borrowerId", memberId).eq("status", "open"),
          )
  ).paginate(opts);
  const now = Date.now();
  for (const loan of page.page) {
    await ctx.db.patch(loan._id, { status: "returned", closedAt: now });
    const copy = await ctx.db
      .query("ownedPuzzles")
      .withIndex("by_aggregate_id", (q) => q.eq("aggregateId", loan.copyId))
      .unique();
    if (copy && copy.heldBy !== undefined) {
      await ctx.db.patch(copy._id, { heldBy: undefined, updatedAt: now });
    }
  }
  return page;
};
