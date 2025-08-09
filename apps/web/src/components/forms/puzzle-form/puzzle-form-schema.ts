import { z } from "zod";

export const puzzleFormSchema = z.object({
  title: z
    .string()
    .min(1, "Title is required")
    .min(3, "Title must be at least 3 characters")
    .max(100, "Title must be less than 100 characters"),

  description: z
    .string()
    .max(500, "Description must be less than 500 characters")
    .optional(),

  brand: z.string().max(50, "Brand must be less than 50 characters").optional(),

  artist: z.string().max(100, "Artist must be less than 100 characters").optional(),

  series: z.string().max(100, "Series must be less than 100 characters").optional(),

  pieceCount: z
    .number()
    .int("Piece count must be a whole number")
    .gte(1, "Piece count must be at least 1"),

  difficulty: z.enum(["easy", "medium", "hard", "expert"]).optional(),

  category: z.string().optional(),

  tags: z.array(z.string()),

  // Identifiers
  ean: z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
    z
      .string()
      .regex(/^[0-9]{13}$/, "EAN must be a 13-digit number")
      .optional(),
  ),
  upc: z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
    z
      .string()
      .regex(/^[0-9]{12}$/, "UPC must be a 12-digit number")
      .optional(),
  ),
  modelNumber: z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
    z
      .string()
      .max(100, "Model number must be less than 100 characters")
      .optional(),
  ),

  // Physical details
  dimensions: z
    .object({
      width: z.number().positive("Width must be greater than 0"),
      height: z.number().positive("Height must be greater than 0"),
      unit: z.enum(["cm", "in"]),
    })
    .optional(),
  shape: z.enum(["rectangular", "panoramic", "round", "shaped"]).optional(),

  image: z.instanceof(File).optional(),
});

export type PuzzleFormData = z.infer<typeof puzzleFormSchema>;
