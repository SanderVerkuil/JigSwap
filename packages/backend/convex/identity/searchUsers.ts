import type { MemberView } from "@jigswap/contracts";
import { v } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import { query } from "../_generated/server";
import {
  countKnownFollowersOf,
  viewerFollowingSet,
} from "../social/knownFollowers";
import { areMutualFollowers, profileVisibilityOf } from "../social/privacy";
import { requireMember } from "./requireMember";
import { toMemberView } from "./toMemberView";

// Identity read (thin adapter): full-text search over name/username via the `by_searchable_name`
// index (a real index lookup, not a full-table scan), capped at `limit` (default 20). Authenticated
// members only; emits the PII-free MemberView.
//
// Profile-visibility gate (mirrors search/globalSearch.ts): a member with a private profile must
// never be surfaced by name/username/avatar to a searcher who is neither them nor a mutual follower.
// We over-fetch candidates from the search index (since some get dropped by the gate) and stop once
// `limit` visible matches are collected, so dropped private rows are refilled toward `limit`.
const CANDIDATE_LIMIT = 50;

// Ranking (from UX research): name-match quality is PRIMARY (bucketed), known-follower count is
// only a WITHIN-BUCKET tiebreaker — a better bucket ALWAYS outranks a worse one, so a brand-new
// member with zero connections is still findable by exact name. 0 = exact (term equals name or
// username), 1 = prefix (term is a startsWith of name or username), 2 = fuzzy (everything else the
// search index surfaced).
type MatchBucket = 0 | 1 | 2;

const matchBucketOf = (
  searchTerm: string,
  user: Pick<Doc<"users">, "name" | "username">,
): MatchBucket => {
  const name = user.name.toLowerCase();
  const username = user.username?.toLowerCase();
  if (name === searchTerm || username === searchTerm) return 0;
  if (name.startsWith(searchTerm) || username?.startsWith(searchTerm)) return 1;
  return 2;
};

export const searchUsers = query({
  args: {
    searchTerm: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<MemberView[]> => {
    const viewerId = (await requireMember(ctx)) as unknown as Id<"users">;
    const limit = args.limit ?? 20;
    // Server-enforced minimum (mirrors the Find-people UI): sub-2-character probes return
    // nothing and never touch the search index — the cheap guard against enumeration scans.
    const searchTerm = args.searchTerm.trim().toLowerCase();
    if (searchTerm.length < 2) return [];

    const candidates = await ctx.db
      .query("users")
      .withSearchIndex("by_searchable_name", (q) =>
        q.search("searchableName", searchTerm),
      )
      .take(CANDIDATE_LIMIT);

    // Built ONCE per query (not per candidate) so ranking every candidate against this viewer
    // doesn't re-scan `follows` by_follower CANDIDATE_LIMIT times.
    const viewerFollowing = await viewerFollowingSet(ctx, viewerId);

    const visible: {
      user: Doc<"users">;
      bucket: MatchBucket;
      knownCount: number;
    }[] = [];
    for (const u of candidates) {
      // Privacy chokepoint: surface a member only if they are the searcher, their
      // profile is public, or they and the searcher are mutual followers. Mirrors
      // globalSearch and getProfile so a private member is not identifiable here.
      const isVisible =
        u._id === viewerId ||
        (await profileVisibilityOf(ctx, u._id)) === "public" ||
        (await areMutualFollowers(ctx, viewerId, u._id));
      if (!isVisible) continue;

      // Bounded: at most CANDIDATE_LIMIT candidates survive the search index, each scanning its
      // own (capped) follower list — fine at this scale, and needed since ranking requires a
      // known-follower count for every visible candidate, not just the first `limit`.
      const knownCount = await countKnownFollowersOf(
        ctx,
        viewerId,
        viewerFollowing,
        u._id,
      );
      visible.push({
        user: u,
        bucket: matchBucketOf(searchTerm, u),
        knownCount,
      });
    }

    // Bucket ascending (better match first) is primary; known-follower count descending is only
    // the within-bucket tiebreaker. Array.sort is stable, so equal (bucket, knownCount) pairs keep
    // the search index's original relevance order.
    visible.sort((a, b) => a.bucket - b.bucket || b.knownCount - a.knownCount);

    return visible.slice(0, limit).map((v) => toMemberView(v.user));
  },
});
