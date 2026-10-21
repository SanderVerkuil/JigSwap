import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { mutation } from "../_generated/server";
import { requireMember } from "../identity/requireMember";
import { enforceRateLimit } from "../lib/rateLimits";
import { requireCircleAdmin } from "./circleAccess";

// An upload URL for a circle icon: only for one of the circle's Admins (anyone else gets
// CircleNotFound), rate limited. The upload is claimed afterwards by setCircleIcon, which checks
// the blob itself.
export const generateCircleIconUploadUrl = mutation({
  args: { circleId: v.string() },
  handler: async (ctx, { circleId }): Promise<string> => {
    const me = (await requireMember(ctx)) as unknown as Id<"users">;
    await requireCircleAdmin(ctx, circleId, me);
    await enforceRateLimit(ctx, "circleIconUploadUrl", me);
    return ctx.storage.generateUploadUrl();
  },
});
