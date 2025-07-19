import { z } from "zod";

export const puzzleFormSchema = z.object({
  title: z.string().min(1, "Title is required"),
  description: z.string().optional(),
  brand: z.string().optional(),
  pieceCount: z.number().min(1, "Piece count must be at least 1"),
  difficulty: z.enum(["easy", "medium", "hard", "expert"]).optional(),
  condition: z.enum(["excellent", "good", "fair", "poor"]),
  category: z.string().optional(),
  tags: z.array(z.string()).optional(),
  images: z.array(z.string()).min(0, "At least one image is required"),
  isCompleted: z.boolean(),
  completedDate: z.number().optional(),
  acquisitionDate: z.number().optional(),
  notes: z.string().optional(),
});

export type PuzzleFormData = z.infer<typeof puzzleFormSchema>;

export const puzzleFormDefaultValues: Partial<PuzzleFormData> = {
  title: "",
  description: "",
  brand: "",
  pieceCount: 1000,
  difficulty: "medium",
  condition: "good",
  category: "",
  tags: [],
  images: [],
  isCompleted: false,
  notes: "",
}; 