import type { LoanView } from "@jigswap/contracts";
import type { Doc, Id } from "../_generated/dataModel";
import { query } from "../_generated/server";
import { canManageCopy } from "../household/copyAccess";
import { householdMateIds } from "../household/memberships";
import { requireMember } from "../identity/requireMember";
import { toLoanView } from "./loanReadViews";

// Open loans where the caller is the lender — their copies currently out on loan — plus open loans
// of household members' copies the caller may manage (so a co-owner can see and recall them).
export const getLentOutLoans = query({
  args: {},
  handler: async (ctx): Promise<LoanView[]> => {
    const me = (await requireMember(ctx)) as unknown as Id<"users">;
    const openLoansOf = (lenderId: Id<"users">): Promise<Doc<"loans">[]> =>
      ctx.db
        .query("loans")
        .withIndex("by_lender", (q) =>
          q.eq("lenderId", lenderId).eq("status", "open"),
        )
        .collect();

    const loans = await openLoansOf(me);
    for (const mateId of await householdMateIds(ctx, me)) {
      for (const loan of await openLoansOf(mateId)) {
        const copy = await ctx.db
          .query("ownedPuzzles")
          .withIndex("by_aggregate_id", (q) => q.eq("aggregateId", loan.copyId))
          .unique();
        if (copy && (await canManageCopy(ctx, me, copy))) loans.push(loan);
      }
    }
    return Promise.all(loans.map((loan) => toLoanView(ctx, loan)));
  },
});
