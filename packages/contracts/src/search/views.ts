// Global-search view DTOs: the lightweight, navigation-ready shapes the ⌘K command palette renders.
// Each hit carries a stable `id`, a display label, an optional thumbnail/secondary, and the `href`
// to navigate to. Grouped per entity so the UI can render labelled sections.

/** A catalog puzzle hit. `href` points at the puzzle detail route. */
export interface PuzzleSearchHit {
  id: string;
  title: string;
  brand?: string;
  /** Already-resolved box-art URL (null when unset). */
  image: string | null;
  href: string;
}

/** A member (person) hit. `href` points at the people surface. */
export interface PersonSearchHit {
  id: string;
  name: string;
  /** Avatar URL (null when unset). */
  image: string | null;
  href: string;
}

/** A friend-circle hit owned-by / belonged-to the signed-in member. */
export interface CircleSearchHit {
  id: string;
  name: string;
  href: string;
}

/** A personal-library collection hit. `href` points at the collection detail route. */
export interface CollectionSearchHit {
  id: string;
  name: string;
  href: string;
}

/** The grouped result set returned by the single global-search query. */
export interface GlobalSearchResults {
  puzzles: PuzzleSearchHit[];
  people: PersonSearchHit[];
  circles: CircleSearchHit[];
  collections: CollectionSearchHit[];
}
