import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { mutation } from "../_generated/server";
import { requireMember } from "../identity/requireMember";
import { requireCircleAdmin } from "./circleAccess";
import { dropCircleIcons } from "./circleIcons";

// Remove the circle's icon: the current one and any upload still in check, rows and blobs
// (sharing/circleIcons.ts), so the circle shows its default again. Only for one of the circle's
// Admins (anyone else gets CircleNotFound).
export const removeCircleIcon = mutation({
  args: { circleId: v.string() },
  handler: async (ctx, { circleId }): Promise<void> => {
    const me = (await requireMember(ctx)) as unknown as Id<"users">;
    const circle = await requireCircleAdmin(ctx, circleId, me);
    await dropCircleIcons(ctx, circle.aggregateId ?? circleId);
  },
});
