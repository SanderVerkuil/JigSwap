import { z } from "zod";
import type { ConvexSystemFields } from "../shared/convex";

/**
 * A member (the wrapper over a Clerk user) as projected to OTHER authenticated members.
 * Deliberately excludes PII (`email`) and the Clerk subject (`clerkId`): those must never be
 * exposed across members (GDPR + identity-provider subject leakage). The self-only `me` query
 * returns {@link CurrentMemberView}, which adds those fields back for the signed-in member.
 */
export interface MemberView extends ConvexSystemFields {
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
 * The signed-in member's own view (the `getCurrentUser` query only). Superset of {@link MemberView}
 * that re-adds the member's own `email` and `clerkId`, plus the raw `slug` (the profile editor needs
 * the caller's own current value to pre-fill the slug editor) — safe because it is only ever
 * returned for the caller's own account, never for another member.
 */
export interface CurrentMemberView extends MemberView {
  clerkId: string;
  email: string;
  slug?: string;
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
