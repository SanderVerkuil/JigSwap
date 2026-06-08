import { z } from "zod";

export const paginationInput = z.object({
  cursor: z.string().nullish(),
  limit: z.number().int().positive().max(100).default(20),
});

export type PaginationInput = z.infer<typeof paginationInput>;
