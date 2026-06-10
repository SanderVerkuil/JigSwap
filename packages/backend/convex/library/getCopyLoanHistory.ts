import type { LoanView } from "@jigswap/contracts";
import { v } from "convex/values";
import { query } from "../_generated/server";
import { toLoanView } from "./loanReadViews";

// A copy's full lending history (every loan, newest first), for the copy detail page.
export const getCopyLoanHistory = query({
  args: { copyId: v.id("ownedPuzzles") },
  handler: async (ctx, args): Promise<LoanView[]> => {
    const copy = await ctx.db.get(args.copyId);
    if (!copy?.aggregateId) return [];
    const loans = await ctx.db
      .query("loans")
      .withIndex("by_copy", (q) => q.eq("copyId", copy.aggregateId as string))
      .order("desc")
      .collect();
    return Promise.all(loans.map((loan) => toLoanView(ctx, loan)));
  },
});
