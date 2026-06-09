import {
  type CatalogCategoryId,
  type CatalogIdGenerator,
  type PuzzleDefinitionId,
  toId,
} from "@jigswap/domain";

// Driven adapter for the CatalogIdGenerator port. crypto.randomUUID is available in the Convex
// runtime; the values are branded and persisted as each aggregate's `aggregateId`.
export const catalogIdGenerator: CatalogIdGenerator = {
  nextPuzzleDefinitionId: (): PuzzleDefinitionId =>
    toId<"PuzzleDefinitionId">(crypto.randomUUID()),
  nextCatalogCategoryId: (): CatalogCategoryId =>
    toId<"CatalogCategoryId">(crypto.randomUUID()),
};
