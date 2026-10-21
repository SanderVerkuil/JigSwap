import type { Locale } from "@/lib/i18n";
import type { PuzzleCategoryView } from "@jigswap/contracts";

// Category filter options from the public taxonomy (catalog.puzzleCategories, already in the
// admin-set order). The value is the adminCategories _id, which is what a puzzle's `category`
// holds; the label follows the UI locale, falling back to English.
export const categoryOptions = (
  categories: readonly Pick<PuzzleCategoryView, "_id" | "name">[],
  locale: Locale,
): { value: string; label: string }[] =>
  categories.map(({ _id, name }) => ({
    value: _id,
    label: name[locale].trim() || name.en,
  }));
