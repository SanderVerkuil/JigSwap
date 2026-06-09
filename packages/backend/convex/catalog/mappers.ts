import type {
  PuzzleCategoryView,
  PuzzleDefinitionView,
  PuzzleSummaryView,
} from "@jigswap/contracts";
import type { Doc } from "../_generated/dataModel";

// Row -> view DTO mappers for the Catalog reads. Pure functions (the storage-URL resolution is
// passed in as an already-resolved value) so the mapping is unit-testable and `tsc` enforces it.

/** The full Catalog definition view; `image` is the already-resolved box-art URL (null when unset). */
export const toPuzzleDefinitionView = (
  row: Doc<"puzzles">,
  image: string | null,
): PuzzleDefinitionView => ({
  _id: row._id,
  _creationTime: row._creationTime,
  aggregateId: row.aggregateId,
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
  category: row.category,
  tags: row.tags,
  image,
  status: row.status,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

/** The lighter list/picker view; `image` is the already-resolved box-art URL (null when unset). */
export const toPuzzleSummaryView = (
  row: Doc<"puzzles">,
  image: string | null,
): PuzzleSummaryView => ({
  _id: row._id,
  _creationTime: row._creationTime,
  aggregateId: row.aggregateId,
  title: row.title,
  description: row.description,
  brand: row.brand,
  pieceCount: row.pieceCount,
  difficulty: row.difficulty,
  category: row.category,
  tags: row.tags,
  image,
  status: row.status,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

/** The localized category taxonomy view. */
export const toPuzzleCategoryView = (
  row: Doc<"adminCategories">,
): PuzzleCategoryView => ({
  _id: row._id,
  _creationTime: row._creationTime,
  aggregateId: row.aggregateId,
  name: row.name,
  description: row.description,
  color: row.color,
  isActive: row.isActive,
  sortOrder: row.sortOrder,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});
