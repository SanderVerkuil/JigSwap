import type { CopyId, Loan, LoanId, LoanRepository } from "@jigswap/domain";
import type { Doc } from "../../_generated/dataModel";
import type { MutationCtx } from "../../_generated/server";
import { toDomain, toRow } from "./loanMapper";

// Driven adapter for the LoanRepository port over the `loans` table; the mapper is the ACL.
export const convexLoanRepository = (ctx: MutationCtx): LoanRepository => {
  const rowById = (id: LoanId): Promise<Doc<"loans"> | null> =>
    ctx.db
      .query("loans")
      .withIndex("by_aggregate_id", (q) => q.eq("aggregateId", id as string))
      .unique();

  return {
    async findById(id: LoanId): Promise<Loan | null> {
      const row = await rowById(id);
      return row ? toDomain(row) : null;
    },

    // Indexed by copy (a copy's loans are few); every loan row is domain-written with an aggregateId.
    async findOpenByCopy(copyId: CopyId): Promise<readonly Loan[]> {
      const rows = await ctx.db
        .query("loans")
        .withIndex("by_copy", (q) => q.eq("copyId", copyId as string))
        .filter((q) => q.eq(q.field("status"), "open"))
        .collect();
      return rows.filter((row) => row.aggregateId !== undefined).map(toDomain);
    },

    async save(loan: Loan): Promise<void> {
      const row = toRow(loan);
      const existing = await rowById(loan.id);
      if (existing) await ctx.db.patch(existing._id, row);
      else await ctx.db.insert("loans", row);
    },
  };
};
