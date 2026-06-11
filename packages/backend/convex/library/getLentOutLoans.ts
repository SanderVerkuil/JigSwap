import type { LoanView } from "@jigswap/contracts";
import type { Id } from "../_generated/dataModel";
import { query } from "../_generated/server";
import { requireMember } from "../identity/requireMember";
import { toLoanView } from "./loanReadViews";

// Open loans where the caller is the lender — their copies currently out on loan.
export const getLentOutLoans = query({
  args: {},
  handler: async (ctx): Promise<LoanView[]> => {
    const me = (await requireMember(ctx)) as unknown as Id<"users">;
    const loans = await ctx.db
      .query("loans")
      .withIndex("by_lender", (q) => q.eq("lenderId", me).eq("status", "open"))
      .collect();
    return Promise.all(loans.map((loan) => toLoanView(ctx, loan)));
  },
});
