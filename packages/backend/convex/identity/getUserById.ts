import type { MemberView } from "@jigswap/contracts";
import { v } from "convex/values";
import { query } from "../_generated/server";
import { requireMember } from "./requireMember";
import { toMemberView } from "./toMemberView";

// Identity read (thin adapter): a member by their _id. Authenticated members only; emits the
// PII-free MemberView.
export const getUserById = query({
  args: { userId: v.id("users") },
  handler: async (ctx, args): Promise<MemberView | null> => {
    await requireMember(ctx);
    const user = await ctx.db.get(args.userId);
    return user ? toMemberView(user) : null;
  },
});
