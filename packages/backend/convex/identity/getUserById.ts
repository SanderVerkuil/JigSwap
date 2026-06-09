import type { MemberView } from "@jigswap/contracts";
import { v } from "convex/values";
import { query } from "../_generated/server";
import { toMemberView } from "./toMemberView";

// Identity read (thin adapter): a member by their _id. Matches legacy users.getUserById.
export const getUserById = query({
  args: { userId: v.id("users") },
  handler: async (ctx, args): Promise<MemberView | null> => {
    const user = await ctx.db.get(args.userId);
    return user ? toMemberView(user) : null;
  },
});
