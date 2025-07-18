import { z } from 'zod';

// Puzzle validation schema
export const puzzleSchema = z.object({
  title: z
    .string()
    .min(1, 'Title is required')
    .min(3, 'Title must be at least 3 characters')
    .max(100, 'Title must be less than 100 characters'),

  description: z
    .string()
    .max(500, 'Description must be less than 500 characters')
    .optional(),

  brand: z.string().max(50, 'Brand must be less than 50 characters').optional(),

  pieceCount: z
    .number()
    .min(1, 'Piece count must be at least 1')
    .max(50000, 'Piece count must be less than 50,000')
    .int('Piece count must be a whole number'),

  difficulty: z.enum(['easy', 'medium', 'hard', 'expert']).optional(),

  condition: z.enum(['excellent', 'good', 'fair', 'poor'], {
    required_error: 'Condition is required',
  }),

  category: z
    .string()
    .max(50, 'Category must be less than 50 characters')
    .optional(),

  tags: z
    .union([z.string(), z.array(z.string())])
    .optional()
    .transform((val) => {
      if (!val) return [];
      if (Array.isArray(val)) return val;
      return val
        .split(',')
        .map((tag) => tag.trim())
        .filter((tag) => tag.length > 0);
    }),

  isCompleted: z.boolean().default(false),

  completedDate: z
    .string()
    .optional()
    .transform((val) => {
      if (!val) return undefined;
      return new Date(val).getTime();
    }),

  acquisitionDate: z
    .string()
    .optional()
    .transform((val) => {
      if (!val) return undefined;
      return new Date(val).getTime();
    }),

  notes: z
    .string()
    .max(1000, 'Notes must be less than 1000 characters')
    .optional(),
});

export type PuzzleFormData = z.infer<typeof puzzleSchema>;

// User profile validation schema
export const profileSchema = z.object({
  name: z
    .string()
    .min(1, 'Name is required')
    .min(2, 'Name must be at least 2 characters')
    .max(50, 'Name must be less than 50 characters'),

  username: z
    .string()
    .min(3, 'Username must be at least 3 characters')
    .max(30, 'Username must be less than 30 characters')
    .regex(
      /^[a-zA-Z0-9_-]+$/,
      'Username can only contain letters, numbers, hyphens, and underscores',
    )
    .optional(),

  bio: z.string().max(500, 'Bio must be less than 500 characters').optional(),

  location: z
    .string()
    .max(100, 'Location must be less than 100 characters')
    .optional(),

  preferredLanguage: z.enum(['en', 'nl']).default('en'),
});

export type ProfileFormData = z.infer<typeof profileSchema>;

// Trade request validation schema
export const tradeRequestSchema = z.object({
  ownerPuzzleId: z.string().min(1, 'Please select a puzzle to request'),

  requesterPuzzleId: z.string().optional(),

  message: z
    .string()
    .max(500, 'Message must be less than 500 characters')
    .optional(),

  proposedTradeDate: z
    .string()
    .optional()
    .transform((val) => {
      if (!val) return undefined;
      return new Date(val).getTime();
    }),

  shippingMethod: z.enum(['pickup', 'mail', 'meetup']).optional(),
});

export type TradeRequestFormData = z.infer<typeof tradeRequestSchema>;

// Contact/Message validation schema
export const messageSchema = z.object({
  subject: z
    .string()
    .min(1, 'Subject is required')
    .min(3, 'Subject must be at least 3 characters')
    .max(100, 'Subject must be less than 100 characters'),

  content: z
    .string()
    .min(1, 'Message is required')
    .min(10, 'Message must be at least 10 characters')
    .max(2000, 'Message must be less than 2000 characters'),

  messageType: z.enum(['text', 'image', 'system']).default('text'),
});

export type MessageFormData = z.infer<typeof messageSchema>;

// Search/Filter validation schemas
export const puzzleSearchSchema = z.object({
  searchTerm: z.string().optional(),
  category: z.string().optional(),
  difficulty: z.enum(['easy', 'medium', 'hard', 'expert']).optional(),
  condition: z.enum(['excellent', 'good', 'fair', 'poor']).optional(),
  minPieceCount: z.number().min(1).optional(),
  maxPieceCount: z.number().min(1).optional(),
  excludeOwnerId: z.string().optional(),
});

export type PuzzleSearchData = z.infer<typeof puzzleSearchSchema>;

// Review validation schema
export const reviewSchema = z.object({
  rating: z
    .number()
    .min(1, 'Rating must be at least 1 star')
    .max(5, 'Rating must be at most 5 stars')
    .int('Rating must be a whole number'),

  comment: z
    .string()
    .max(1000, 'Comment must be less than 1000 characters')
    .optional(),

  categories: z.object({
    communication: z.number().min(1).max(5).int(),
    packaging: z.number().min(1).max(5).int(),
    condition: z.number().min(1).max(5).int(),
    timeliness: z.number().min(1).max(5).int(),
  }),
});

export type ReviewFormData = z.infer<typeof reviewSchema>;

// Utility function to transform form data for API calls
export const transformPuzzleData = (data: PuzzleFormData) => {
  return {
    ...data,
    pieceCount: Number(data.pieceCount),
    tags: Array.isArray(data.tags) ? data.tags : [],
    images: [], // Will be handled separately for file uploads
  };
};

// Validation error formatter
export const formatValidationErrors = (error: z.ZodError) => {
  const errors: Record<string, string> = {};

  error.errors.forEach((err) => {
    const path = err.path.join('.');
    errors[path] = err.message;
  });

  return errors;
};
