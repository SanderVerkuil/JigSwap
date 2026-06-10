import type { LoanView } from "@jigswap/contracts";
import type { Id } from "../_generated/dataModel";
import { query } from "../_generated/server";
import { requireMember } from "../identity/requireMember";
import { toLoanView } from "./loanReadViews";

// Open loans where the caller is the borrower — the copies they are currently holding.
export const getBorrowedLoans = query({
  args: {},
  handler: async (ctx): Promise<LoanView[]> => {
    const me = (await requireMember(ctx)) as unknown as Id<"users">;
    const loans = await ctx.db
      .query("loans")
      .withIndex("by_borrower", (q) =>
        q.eq("borrowerId", me).eq("status", "open"),
      )
      .collect();
    return Promise.all(loans.map((loan) => toLoanView(ctx, loan)));
  },
});
