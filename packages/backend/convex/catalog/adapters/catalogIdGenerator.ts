import {
  type CatalogCategoryId,
  type CatalogIdGenerator,
  type ChangeProposalId,
  type PuzzleDefinitionId,
  toCatalogCategoryId,
  toChangeProposalId,
  toPuzzleDefinitionId,
} from "@jigswap/domain";

// Driven adapter for the CatalogIdGenerator port. crypto.randomUUID is available in the Convex
// runtime; the values are branded and persisted as each aggregate's `aggregateId`.
export const catalogIdGenerator: CatalogIdGenerator = {
  nextPuzzleDefinitionId: (): PuzzleDefinitionId =>
    toPuzzleDefinitionId(crypto.randomUUID()),
  nextCatalogCategoryId: (): CatalogCategoryId =>
    toCatalogCategoryId(crypto.randomUUID()),
  nextChangeProposalId: (): ChangeProposalId =>
    toChangeProposalId(crypto.randomUUID()),
};
