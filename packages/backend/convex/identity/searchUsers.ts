import type { MemberView } from "@jigswap/contracts";
import { v } from "convex/values";
import { query } from "../_generated/server";
import { requireMember } from "./requireMember";
import { toMemberView } from "./toMemberView";

// Identity read (thin adapter): case-insensitive substring search over name/username/location,
// capped at `limit` (default 20). Authenticated members only; emits the PII-free MemberView.
export const searchUsers = query({
  args: {
    searchTerm: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<MemberView[]> => {
    await requireMember(ctx);
    const limit = args.limit ?? 20;
    const searchTerm = args.searchTerm.toLowerCase();

    const users = await ctx.db.query("users").collect();

    return users
      .filter(
        (user) =>
          user.name.toLowerCase().includes(searchTerm) ||
          (user.username && user.username.toLowerCase().includes(searchTerm)) ||
          (user.location && user.location.toLowerCase().includes(searchTerm)),
      )
      .slice(0, limit)
      .map(toMemberView);
  },
});
