import { z } from "zod";

// Completion entry schema
const completionEntrySchema = z.object({
  id: z.string(),
  completedDate: z.number(),
  completionTimeMinutes: z.number().optional(),
  notes: z.string().optional(),
});

export const puzzleFormSchema = z.object({
  // Product fields
  title: z.string().min(1, "Title is required"),
  description: z.string().optional(),
  brand: z.string().optional(),
  pieceCount: z.number().min(1, "Piece count must be at least 1"),
  difficulty: z.enum(["easy", "medium", "hard", "expert"]).optional(),
  category: z.string().optional(), // Keep as string for form compatibility
  tags: z.array(z.string()).optional(),
  newTag: z.string().optional(),
  images: z.array(z.string()).min(0, "At least one image is required"),
  
  // Instance fields
  condition: z.enum(["excellent", "good", "fair", "poor"]),
  isAvailable: z.boolean(),
  acquisitionDate: z.number().optional(),
  notes: z.string().optional(),
  
  // Legacy fields for backward compatibility
  isCompleted: z.boolean().optional(),
  completedDate: z.number().optional(),
  completions: z.array(completionEntrySchema).optional(),
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
  newTag: "",
  images: [],
  isAvailable: true,
  notes: "",
  completions: [],
}; 