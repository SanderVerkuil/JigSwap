import { z } from "zod";

// Backend Convex condition enum (library.createOwned).
export const CONDITION_VALUES = [
  "new_sealed",
  "like_new",
  "good",
  "fair",
  "poor",
] as const;
export type ConditionValue = (typeof CONDITION_VALUES)[number];

// The four condition pills shown in the design, in order, each mapped to a backend value.
export const CONDITION_OPTIONS: ReadonlyArray<{
  label: string;
  value: ConditionValue;
}> = [
  { label: "Excellent", value: "like_new" },
  { label: "Good", value: "good" },
  { label: "Fair", value: "fair" },
  { label: "Poor", value: "poor" },
];

export const DIFFICULTY_OPTIONS = [
  { value: "easy", label: "Easy", dot: "bg-jigsaw-secondary" },
  { value: "medium", label: "Medium", dot: "bg-amber-400" },
  { value: "hard", label: "Hard", dot: "bg-orange-500" },
  { value: "expert", label: "Expert", dot: "bg-red-500" },
] as const;

export const PIECE_PRESETS = [300, 500, 750, 1000, 1500, 2000] as const;

export const COVER_SWATCHES = [
  "var(--jigsaw-primary)",
  "var(--jigsaw-secondary)",
  "var(--jigsaw-puzzle)",
  "var(--jigsaw-warning)",
  "#f97316", // orange-500
  "var(--jig-violet-700, #3a3f76)",
  "#0d680c", // green-700
  "#db2777", // pink-500
] as const;

// Flow A: add-to-library form (catalog + instance fields).
export const addToLibrarySchema = z.object({
  title: z.string().min(1, "Title is required").max(100),
  brand: z.string().min(1, "Brand is required").max(50),
  pieceCount: z.number().int().gte(1, "Piece count is required"),
  difficulty: z.enum(["easy", "medium", "hard", "expert"]).optional(),
  condition: z.enum(CONDITION_VALUES),
  availability: z.object({
    forTrade: z.boolean(),
    forLend: z.boolean(),
    forSale: z.boolean(),
  }),
  coverColor: z.string(),
  tags: z.array(z.string()),
  notes: z.string().max(1000).optional(),
  ean: z.string().optional(),
  upc: z.string().optional(),
});
export type AddToLibraryData = z.infer<typeof addToLibrarySchema>;
