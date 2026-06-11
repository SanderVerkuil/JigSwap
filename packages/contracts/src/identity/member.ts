import { z } from "zod";
import type { ConvexSystemFields } from "../shared/convex";

/**
 * A member (the wrapper over a Clerk user). Faithful superset of the `users` document the legacy
 * `getCurrentUser` / `getUserByClerkId` / `getUserById` / `searchUsers` reads returned raw, so
 * consumers that read `_id`, `name`, `avatar`, `bio`, `location`, etc. keep working unchanged.
 */
export interface MemberView extends ConvexSystemFields {
  clerkId: string;
  email: string;
  name: string;
  username?: string;
  avatar?: string;
  bio?: string;
  location?: string;
  preferredLanguage?: string;
  isActive: boolean;
  createdAt: number;
  updatedAt: number;
}

/**
 * The member-stats card (legacy `getUserStats`). `puzzlesAvailable` mirrors `puzzlesOwned` exactly
 * as the legacy query did; preserved so the dashboard/profile read identical fields.
 */
export const memberStatsView = z.object({
  puzzlesOwned: z.number(),
  puzzlesAvailable: z.number(),
  tradesCompleted: z.number(),
  averageRating: z.number(),
  totalReviews: z.number(),
});

export type MemberStatsView = z.infer<typeof memberStatsView>;

/**
 * Platform-wide counters surfaced on the public landing page (legacy `getGlobalStats`). Kept under
 * identity because it counts members alongside catalog/library totals; the gateway exposes it via
 * `insights.globalStats`.
 */
export const globalStatsView = z.object({
  totalUsers: z.number(),
  totalPuzzles: z.number(),
  totalOwnedPuzzles: z.number(),
});

export type GlobalStatsView = z.infer<typeof globalStatsView>;
