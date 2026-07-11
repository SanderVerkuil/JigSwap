import type { MemberView } from "@jigswap/contracts";
import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { query } from "../_generated/server";
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

    const results: MemberView[] = [];
    for (const u of candidates) {
      if (results.length >= limit) break;
      // Privacy chokepoint: surface a member only if they are the searcher, their
      // profile is public, or they and the searcher are mutual followers. Mirrors
      // globalSearch and getProfile so a private member is not identifiable here.
      const visible =
        u._id === viewerId ||
        (await profileVisibilityOf(ctx, u._id)) === "public" ||
        (await areMutualFollowers(ctx, viewerId, u._id));
      if (!visible) continue;
      results.push(toMemberView(u));
    }

    return results;
  },
});
