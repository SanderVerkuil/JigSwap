// Catalog read-model view DTOs: the typed shapes the gateway's `catalog:` reads return, replacing
// raw Convex rows. Each is a faithful superset of exactly what today's UI consumers read, so the
// read cutover is behaviour-preserving. Ids are carried as branded-ish string aliases (the Convex
// `Id<...>` is a string at runtime); the web app re-casts them to its own `Id<...>` at the edge.

export type PuzzleDifficulty = "easy" | "medium" | "hard" | "expert";

/** A reference to a Convex document id, surfaced to the UI as the opaque string it is at runtime. */
export type DocId = string;

/**
 * The full Catalog puzzle definition, as returned by `catalog.puzzleById`. `image` is the resolved
 * box-art URL (null when unset), NOT the raw storage id. `aggregateId` is the PuzzleDefinitionId the
 * Library acquire path keys on; legacy rows may lack it.
 */
export interface PuzzleDefinitionView {
  _id: DocId;
  _creationTime: number;
  aggregateId?: string;
  title: string;
  description?: string;
  brand?: string;
  pieceCount: number;
  artist?: string;
  series?: string;
  ean?: string;
  upc?: string;
  modelNumber?: string;
  dimensions?: {
    width: number;
    height: number;
    unit: "cm" | "in";
  };
  shape?: "rectangular" | "panoramic" | "round" | "shaped";
  difficulty?: PuzzleDifficulty;
  category?: DocId;
  tags?: string[];
  image?: string | null;
  status: "pending" | "approved" | "rejected" | "disabled";
  createdAt: number;
  updatedAt: number;
}

/**
 * A lighter Catalog puzzle row for browsable lists/rails (`catalog.listAll`, `catalog.recentPuzzles`)
 * and the add-copy picker suggestions (`catalog.puzzleSuggestions`). Carries the resolved box-art URL
 * and the fields the PuzzleCard / picker render.
 */
export interface PuzzleSummaryView {
  _id: DocId;
  _creationTime: number;
  aggregateId?: string;
  title: string;
  description?: string;
  brand?: string;
  pieceCount: number;
  difficulty?: PuzzleDifficulty;
  category?: DocId;
  tags?: string[];
  image?: string | null;
  status: "pending" | "approved" | "rejected" | "disabled";
  createdAt: number;
  updatedAt: number;
}

/** The localized, admin-moderated category taxonomy row, as returned by `catalog.puzzleCategories`. */
export interface PuzzleCategoryView {
  _id: DocId;
  _creationTime: number;
  aggregateId?: string;
  name: { en: string; nl: string };
  description?: { en: string; nl: string };
  color?: string;
  isActive: boolean;
  sortOrder: number;
  createdAt: number;
  updatedAt: number;
}

/**
 * One row of the admin puzzle-definitions console (`admin.listPuzzleDefinitions`): catalog
 * facts plus admin metadata (submitter display name, distinct-owner count, resolved thumbnail
 * URL). Unlike the public views it carries EVERY moderation status. Disable/re-enable actions
 * key on `aggregateId`; legacy rows without one still render but their actions are disabled.
 */
export interface AdminPuzzleDefinitionRowView {
  _id: DocId;
  aggregateId?: string;
  title: string;
  brand?: string;
  pieceCount: number;
  status: "pending" | "approved" | "rejected" | "disabled";
  createdAt: number;
  submitterName: string | null;
  image: string | null;
  ownerCount: number;
}

/** A distinct brand name from the Catalog. Optional because the underlying column is optional. */
export type BrandView = string | undefined;

/** A distinct tag from the Catalog. */
export type TagView = string;
