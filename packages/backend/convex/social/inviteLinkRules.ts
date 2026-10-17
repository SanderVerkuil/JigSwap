import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";

// Shared rules for the two kinds of inviteLinks rows (spec §3.4):
// - the NETWORK link (context absent): one active row per member, no expiry, reset on demand;
// - HOUSEHOLD links (context.kind "household"): minted by the household admin, single-use,
//   expiring 14 days after creation, at most 5 open and 10 created per rolling 24h per inviter.

const DAY_MS = 24 * 60 * 60 * 1000;
export const HOUSEHOLD_LINK_TTL_MS = 14 * DAY_MS;
export const MAX_OPEN_HOUSEHOLD_LINKS = 5;
export const MAX_HOUSEHOLD_LINKS_PER_DAY = 10;
export const HOUSEHOLD_LINK_WINDOW_MS = DAY_MS;

export const isNetworkLink = (link: Doc<"inviteLinks">): boolean =>
  link.context === undefined;

// A token that may still be acted on: not revoked and, for a household link, neither consumed
// nor expired. Expired or consumed household links are invalid as a whole.
export const isLiveLink = (link: Doc<"inviteLinks">, now: number): boolean => {
  if (link.revokedAt !== undefined) return false;
  if (isNetworkLink(link)) return true;
  return (
    link.consumedAt === undefined &&
    link.expiresAt !== undefined &&
    link.expiresAt > now
  );
};

// The inviter's household links that could still be open or count toward the 24h limit. Any row
// created before the TTL has expired, so the read is bounded by an index range on _creationTime
// (at most 10 per day over 14 days, plus a few network rows).
export const recentHouseholdLinks = async (
  ctx: QueryCtx,
  ownerId: Id<"users">,
  now: number,
): Promise<Doc<"inviteLinks">[]> => {
  const rows = await ctx.db
    .query("inviteLinks")
    .withIndex("by_owner", (q) =>
      q.eq("ownerId", ownerId).gt("_creationTime", now - HOUSEHOLD_LINK_TTL_MS),
    )
    .collect();
  return rows.filter((row) => !isNetworkLink(row));
};
