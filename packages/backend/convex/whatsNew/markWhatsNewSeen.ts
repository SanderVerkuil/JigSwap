import { ConvexError, v } from "convex/values";
import { mutation } from "../_generated/server";
import { markSeen, requireMemberUser } from "./readState";

export const MAX_SEEN_BATCH = 50;

// Mark specific entries seen (modal close, notification open). Ids the backend's manifest doesn't
// know are ignored rather than rejected: web and Convex deploy separately, and this write is
// fire-and-forget, so a short deploy skew must not surface as an error.
export const markWhatsNewSeen = mutation({
  args: { ids: v.array(v.string()) },
  handler: async (ctx, { ids }) => {
    const member = await requireMemberUser(ctx);
    if (ids.length > MAX_SEEN_BATCH) {
      throw new ConvexError({ code: "too_many_ids" });
    }
    await markSeen(ctx, member, ids);
  },
});
