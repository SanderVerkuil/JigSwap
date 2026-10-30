import { err, ok, Result } from "../../shared-kernel";
import { CatalogError } from "./errors";

// Bounds on the free text a puzzle definition, or a change proposal against one, carries. Every
// definition is read by public browse, the brand/publisher/series/tag facets and the admin
// queue, and every submission or proposal notifies each admin, so none may grow to the size of a
// document (SEC-26). Checked when text is written (submit, update, file, edit), never on
// rehydrate, so rows stored before the bounds existed stay readable.
export const CATALOG_TEXT_LIMITS = {
  title: 200,
  description: 5_000,
  brand: 100,
  publisher: 100,
  artist: 100,
  series: 100,
  modelNumber: 100,
  category: 64,
  tag: 50,
  comment: 2_000,
} as const;

// The most tags one definition may carry.
export const MAX_CATALOG_TAGS = 20;

export type CatalogTextField = keyof typeof CATALOG_TEXT_LIMITS | "tags";

// The text to check; an absent field is not checked.
export interface CatalogText {
  readonly title?: string;
  readonly description?: string;
  readonly brand?: string;
  readonly publisher?: string;
  readonly artist?: string;
  readonly series?: string;
  readonly modelNumber?: string;
  readonly category?: string;
  readonly tags?: readonly string[];
  readonly comment?: string;
}

const STRING_FIELDS = [
  "title",
  "description",
  "brand",
  "publisher",
  "artist",
  "series",
  "modelNumber",
  "category",
  "comment",
] as const;

// Whether every present field is within its bound; the first one past it is the error.
export const checkCatalogText = (
  text: CatalogText,
): Result<void, CatalogError> => {
  for (const field of STRING_FIELDS) {
    const max = CATALOG_TEXT_LIMITS[field];
    if ((text[field]?.length ?? 0) > max) {
      return err(CatalogError.textTooLong(field, max));
    }
  }
  if (text.tags !== undefined) {
    if (text.tags.length > MAX_CATALOG_TAGS) {
      return err(CatalogError.textTooLong("tags", MAX_CATALOG_TAGS));
    }
    if (text.tags.some((tag) => tag.length > CATALOG_TEXT_LIMITS.tag)) {
      return err(CatalogError.textTooLong("tag", CATALOG_TEXT_LIMITS.tag));
    }
  }
  return ok(undefined);
};
