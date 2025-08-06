import { z } from "zod";

export const puzzleProductFormSchema = z.object({
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

  pieceCount: z
    .number()
    .int("Piece count must be a whole number")
    .gte(1, "Piece count must be at least 1"),

  difficulty: z.enum(["easy", "medium", "hard", "expert"]).optional(),

  category: z.string().optional(),

  tags: z.array(z.string()),

  image: z.instanceof(File).optional(),
});

export type PuzzleProductFormData = z.infer<typeof puzzleProductFormSchema>;
