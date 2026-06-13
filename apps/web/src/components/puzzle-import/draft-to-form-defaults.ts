import type { PuzzleFormData } from "@/components/forms/puzzle-form";

// The draft fields returned by the extractFromUrl action (mirrors domain PuzzleImportDraft).
export interface ImportedDraft {
  title: string;
  brand?: string;
  imageUrl?: string;
  description?: string;
  ean?: string;
  upc?: string;
  pieceCount?: number;
  sourceUrl: string;
}

// Map a scraped draft onto PuzzleForm default values. pieceCount stays undefined when unknown so
// the user must confirm it (the form requires >= 1). The remote image is handled separately by
// the page on confirm (importPuzzleImage); the form `image` field stays empty.
export const draftToFormDefaults = (draft: ImportedDraft): PuzzleFormData => ({
  title: draft.title ?? "",
  description: draft.description ?? "",
  brand: draft.brand ?? "",
  artist: "",
  series: "",
  pieceCount: draft.pieceCount as unknown as number,
  difficulty: undefined,
  category: undefined,
  tags: [],
  ean: draft.ean ?? "",
  upc: draft.upc ?? "",
  modelNumber: "",
  dimensions: undefined,
  shape: undefined,
  image: undefined,
});
