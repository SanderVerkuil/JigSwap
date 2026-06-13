// packages/domain/src/catalog/domain/puzzle-import-draft.ts

// A reviewable draft extracted from a store page. Persists nothing; the user confirms before
// any puzzle is created. `imageUrl` is a remote URL, NOT a stored Convex storage id.
export interface PuzzleImportDraft {
  readonly title: string;
  readonly brand?: string;
  readonly imageUrl?: string;
  readonly description?: string;
  readonly ean?: string; // gtin13 / 13-digit gtin
  readonly upc?: string; // gtin12 / 12-digit gtin
  readonly pieceCount?: number;
  readonly sourceUrl: string;
}

// A scraper-agnostic normalization of a fetched product page. The page-fetcher adapter maps the
// concrete scraper output (ogie) into this shape so the pure extractor never sees ogie types.
export interface JsonLdProduct {
  readonly name?: string;
  readonly brand?: string; // already flattened from string | { name } by the adapter
  readonly description?: string;
  readonly image?: string | readonly string[];
  readonly gtin13?: string;
  readonly gtin12?: string;
  readonly gtin?: string;
}

export interface RawProductPage {
  readonly ogTitle?: string;
  readonly ogDescription?: string;
  readonly ogImages: readonly string[];
  readonly basicTitle?: string; // <title>
  readonly basicDescription?: string; // <meta name="description">
  readonly jsonLdProducts: readonly JsonLdProduct[];
}
