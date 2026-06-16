import type { MemberView } from "@jigswap/contracts";
import { v } from "convex/values";
import { query } from "../_generated/server";
import { requireMember } from "./requireMember";
import { toMemberView } from "./toMemberView";

// Identity read (thin adapter): full-text search over name/username via the `by_searchable_name`
// index (a real index lookup, not a full-table scan), capped at `limit` (default 20). Authenticated
// members only; emits the PII-free MemberView.
export const searchUsers = query({
  args: {
    searchTerm: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<MemberView[]> => {
    await requireMember(ctx);
    const limit = args.limit ?? 20;
    const searchTerm = args.searchTerm.trim().toLowerCase();
    if (searchTerm.length === 0) return [];

    const users = await ctx.db
      .query("users")
      .withSearchIndex("by_searchable_name", (q) =>
        q.search("searchableName", searchTerm),
      )
      .take(limit);

    return users.map(toMemberView);
  },
});
