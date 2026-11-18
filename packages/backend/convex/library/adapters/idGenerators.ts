import {
  toCollectionId,
  toCopyId,
  toLoanId,
  type CollectionId,
  type CollectionIdGenerator,
  type CopyId,
  type CopyIdGenerator,
  type LoanId,
  type LoanIdGenerator,
} from "@jigswap/domain";

// Driven adapters for the Library id-generator ports. crypto.randomUUID is available in the
// Convex runtime; the values are branded and persisted as each aggregate's `aggregateId`.
export const copyIdGenerator: CopyIdGenerator = {
  next: (): CopyId => toCopyId(crypto.randomUUID()),
};

export const collectionIdGenerator: CollectionIdGenerator = {
  next: (): CollectionId => toCollectionId(crypto.randomUUID()),
};

export const loanIdGenerator: LoanIdGenerator = {
  next: (): LoanId => toLoanId(crypto.randomUUID()),
};
