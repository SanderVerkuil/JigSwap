import type { LoanView, ProjectedLoanView } from "@jigswap/contracts";
import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { toMemberIdentityView } from "../identity/toMemberView";
import { projectMemberIdentity } from "../social/privacy";

// Resolve a loan row into a typed LoanView: join the copy (title/pieces) and both members. The
// parties are identity only (SEC-11): a member's own loan names the other party whatever their
// profile visibility or a block (it is a physical copy changing hands), but never with their bio,
// location or language. Household co-managers who see the loan through getLentOutLoans get the
// same identity-only view.
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
    // A departed (deleted or deactivated) party is null: the web renders "Deleted member".
    lender: lender?.isActive ? toMemberIdentityView(lender) : null,
    borrower: borrower?.isActive ? toMemberIdentityView(borrower) : null,
  };
};

// Resolve a loan into a ProjectedLoanView for a Copy's PUBLIC lending history: identical to
// toLoanView but both parties are run through projectMemberIdentity (salt = the copy's _id, matching
// getCopyInstanceView) so a hidden member's real identity never crosses the wire.
export const toProjectedLoanView = async (
  ctx: QueryCtx,
  loan: Doc<"loans">,
  viewerId: Id<"users">,
  salt: string,
): Promise<ProjectedLoanView> => {
  const base = await toLoanView(ctx, loan);
  const [lender, borrower] = await Promise.all([
    projectMemberIdentity(ctx, viewerId, loan.lenderId, salt),
    projectMemberIdentity(ctx, viewerId, loan.borrowerId, salt),
  ]);
  return { ...base, lender, borrower };
};
