import { Loan, toCopyId, toLoanId, toOwnerId } from "@jigswap/domain";
import type { Doc, Id } from "../../_generated/dataModel";

// ACL between the persisted `loans` row and the Loan aggregate. copyId is the Library CopyId
// (a string); lender/borrower FK columns store the resolved users `_id`.
export type LoanRow = Omit<Doc<"loans">, "_id" | "_creationTime">;

export const toDomain = (row: Doc<"loans">): Loan =>
  Loan.rehydrate({
    id: toLoanId(row.aggregateId as string),
    copyId: toCopyId(row.copyId),
    lenderId: toOwnerId(row.lenderId as unknown as string),
    borrowerId: toOwnerId(row.borrowerId as unknown as string),
    status: row.status,
    openedAt: new Date(row.openedAt),
    expectedReturn:
      row.expectedReturn === undefined
        ? undefined
        : new Date(row.expectedReturn),
    closedAt: row.closedAt === undefined ? undefined : new Date(row.closedAt),
  });

export const toRow = (loan: Loan): LoanRow => {
  const state = loan.toState();
  return {
    aggregateId: state.id as string,
    copyId: state.copyId as string,
    lenderId: state.lenderId as unknown as Id<"users">,
    borrowerId: state.borrowerId as unknown as Id<"users">,
    status: state.status,
    openedAt: state.openedAt.getTime(),
    expectedReturn: state.expectedReturn?.getTime(),
    closedAt: state.closedAt?.getTime(),
  };
};
