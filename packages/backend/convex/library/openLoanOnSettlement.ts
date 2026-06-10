import {
  type CopyId,
  makeOpenLoan,
  type OwnerId,
  toId,
} from "@jigswap/domain";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { convexCopyRepository } from "./adapters/convexCopyRepository";
import { convexLoanRepository } from "./adapters/convexLoanRepository";
import { noopEventPublisher } from "./adapters/eventPublisher";
import { loanIdGenerator } from "./adapters/idGenerators";
import { systemClock } from "./adapters/systemClock";

// Library's reaction to a settled LEND (Exchange's PossessionTransferred): open an open-ended Loan
// and move possession of the copy to the borrower. Ownership stays with the lender (the copy owner).
export const handleDomainEvent = async (
  ctx: MutationCtx,
  event: Doc<"domainEvents">,
): Promise<void> => {
  if (event.name !== "PossessionTransferred") return;
  const p = event.payload as Record<string, unknown>;

  const copyRow = await ctx.db.get(p.copyId as Id<"ownedPuzzles">);
  if (!copyRow?.aggregateId) return; // only domain-written copies have a CopyId to loan.

  const openLoan = makeOpenLoan({
    copies: convexCopyRepository(ctx),
    loans: convexLoanRepository(ctx),
    ids: loanIdGenerator,
    events: noopEventPublisher(ctx),
    clock: systemClock,
  });
  await openLoan({
    copyId: toId<"CopyId">(copyRow.aggregateId) as CopyId,
    borrowerId: toId<"OwnerId">(p.borrower as string) as OwnerId,
    expectedReturn:
      p.expectedReturn === undefined
        ? undefined
        : new Date(p.expectedReturn as number),
  });
};
