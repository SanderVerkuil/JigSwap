import type { LoanView } from "@jigswap/contracts";
import type { Doc } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { toMemberView } from "../identity/toMemberView";

// Resolve a loan row into a typed LoanView: join the copy (title/pieces) and both members.
export const toLoanView = async (
  ctx: QueryCtx,
  loan: Doc<"loans">,
): Promise<LoanView> => {
  const copy = await ctx.db
    .query("ownedPuzzles")
    .withIndex("by_aggregate_id", (q) => q.eq("aggregateId", loan.copyId))
    .unique();
  const puzzle = copy ? await ctx.db.get(copy.puzzleId) : null;
  const [lender, borrower] = await Promise.all([
    ctx.db.get(loan.lenderId),
    ctx.db.get(loan.borrowerId),
  ]);

  return {
    loanId: loan.aggregateId as string,
    copyId: loan.copyId,
    copyDocId: (copy?._id ?? "") as string,
    puzzleTitle: copy?.snapshot?.title ?? puzzle?.title ?? "Unknown Puzzle",
    pieceCount: copy?.snapshot?.pieceCount ?? puzzle?.pieceCount ?? 0,
    status: loan.status,
    openedAt: loan.openedAt,
    expectedReturn: loan.expectedReturn,
    closedAt: loan.closedAt,
    lender: lender ? toMemberView(lender) : null,
    borrower: borrower ? toMemberView(borrower) : null,
  };
};
