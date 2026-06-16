import type { ProjectedLoanView } from "@jigswap/contracts";
import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { query } from "../_generated/server";
import { requireMember } from "../identity/requireMember";
import { toProjectedLoanView } from "./loanReadViews";

// A copy's full lending history (every loan, newest first), for the copy detail page. Auth-gated;
// both parties of every loan are privacy-projected (salt = copyId), so a hidden member's identity
// never crosses the wire — consistent with getCopyInstanceView's loan projection.
export const getCopyLoanHistory = query({
  args: { copyId: v.id("ownedPuzzles") },
  handler: async (ctx, args): Promise<ProjectedLoanView[]> => {
    const viewerId = (await requireMember(ctx)) as unknown as Id<"users">;

    const copy = await ctx.db.get(args.copyId);
    if (!copy?.aggregateId) return [];
    const salt = args.copyId as string;
    const loans = await ctx.db
      .query("loans")
      .withIndex("by_copy", (q) => q.eq("copyId", copy.aggregateId as string))
      .order("desc")
      .collect();
    return Promise.all(
      loans.map((loan) => toProjectedLoanView(ctx, loan, viewerId, salt)),
    );
  },
});
