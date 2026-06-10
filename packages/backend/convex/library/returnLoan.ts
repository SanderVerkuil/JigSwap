import {
  type LoanId,
  makeReturnLoan,
  type OwnerId,
  toId,
} from "@jigswap/domain";
import { v } from "convex/values";
import { mutation } from "../_generated/server";
import { requireMember } from "../identity/requireMember";
import { convexCopyRepository } from "./adapters/convexCopyRepository";
import { convexLoanRepository } from "./adapters/convexLoanRepository";
import { noopEventPublisher } from "./adapters/eventPublisher";
import { systemClock } from "./adapters/systemClock";
import { toConvexError } from "./errors";

// The borrower returns a borrowed copy; only the borrower may. `loanId` is the domain aggregateId.
export const returnLoan = mutation({
  args: { loanId: v.string() },
  handler: async (ctx, args) => {
    const actingMemberId = (await requireMember(ctx)) as unknown as OwnerId;

    const result = await makeReturnLoan({
      loans: convexLoanRepository(ctx),
      copies: convexCopyRepository(ctx),
      events: noopEventPublisher(ctx),
      clock: systemClock,
    })({
      loanId: toId<"LoanId">(args.loanId) as LoanId,
      actingMemberId,
    });
    if (result.isErr) throw toConvexError(result.error);
  },
});
