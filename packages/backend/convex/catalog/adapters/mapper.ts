import {
  type CatalogCategoryId,
  PuzzleDefinition,
  type PuzzleDefinitionState,
  toPuzzleDefinitionId,
  toSubmitterId,
} from "@jigswap/domain";
import type { Doc, Id } from "../../_generated/dataModel";

// ACL between the persisted `puzzles` row and the PuzzleDefinition aggregate. Schema shape
// stops here and never ripples into the domain.

// The insert/patch payload (the row minus Convex-managed `_id`/`_creationTime`). The `category`
// FK is excluded here because the mapper is pure and cannot resolve the real `adminCategories._id`
// from the Catalog CatalogCategoryId — the repository resolves and supplies it.
export type PuzzleRow = Omit<
  Doc<"puzzles">,
  "_id" | "_creationTime" | "category"
>;

// Row -> aggregate. The row MUST carry an aggregateId (only domain-written rows do); callers
// guard for it before mapping. The `category` column is an `adminCategories._id`, so the
// repository resolves it back to the CatalogCategoryId and passes it in — the mapper never
// re-brands the raw FK as an aggregate id. searchableText is derived, never read back into state.
export const toDomain = (
  row: Doc<"puzzles">,
  categoryAggregateId: CatalogCategoryId | undefined,
): PuzzleDefinition =>
  PuzzleDefinition.rehydrate({
    id: toPuzzleDefinitionId(row.aggregateId as string),
    title: row.title,
    description: row.description,
    brand: row.brand,
    pieceCount: row.pieceCount,
    artist: row.artist,
    series: row.series,
    ean: row.ean,
    upc: row.upc,
    modelNumber: row.modelNumber,
    dimensions: row.dimensions,
    shape: row.shape,
    difficulty: row.difficulty,
    category: categoryAggregateId,
    tags: row.tags,
    image: row.image as unknown as string | undefined,
    status: row.status,
    submittedBy: toSubmitterId(row.submittedBy as unknown as string),
    createdAt: new Date(row.createdAt),
    updatedAt: new Date(row.updatedAt),
  });

// Aggregate -> row payload (without the `category` FK, which the repository fills with the
// resolved real `adminCategories._id`). Domain PuzzleDefinitionId becomes `aggregateId`; foreign
// id strings are re-branded to Convex Ids for their columns. CRITICAL: searchableText is NOT in
// toState() — it is a derived projection, so we materialise definition.searchableText() here.
export const toRow = (definition: PuzzleDefinition): PuzzleRow => {
  const state: PuzzleDefinitionState = definition.toState();
  return {
    aggregateId: state.id as string,
    title: state.title,
    description: state.description,
    brand: state.brand,
    pieceCount: state.pieceCount,
    artist: state.artist,
    series: state.series,
    ean: state.ean,
    upc: state.upc,
    modelNumber: state.modelNumber,
    dimensions: state.dimensions,
    shape: state.shape,
    difficulty: state.difficulty,
    tags: state.tags ? [...state.tags] : undefined,
    image: state.image ? (state.image as unknown as Id<"_storage">) : undefined,
    // Materialise the derived search projection into the column on every write.
    searchableText: definition.searchableText(),
    status: state.status,
    submittedBy: state.submittedBy as unknown as Id<"users">,
    createdAt: state.createdAt.getTime(),
    updatedAt: state.updatedAt.getTime(),
  };
};
