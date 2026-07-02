import { ConvexError, v } from "convex/values";
import { query } from "../_generated/server";
import { isAdmin } from "../identity/isAdmin";
import { requireMember } from "../identity/requireMember";

// Activity feed for the moderation console: the latest moderation decisions, newest first,
// with the acting admin's display name joined in (null = automated pipeline). Admin-only,
// gated exactly like listPendingPuzzleDefinitions.
export const getModerationActivity = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit }) => {
    await requireMember(ctx);
    if (!(await isAdmin(ctx))) throw new ConvexError("Forbidden");

    const rows = await ctx.db
      .query("moderationActions")
      .withIndex("by_at")
      .order("desc")
      .take(limit ?? 30);

    return Promise.all(
      rows.map(async (row) => ({
        kind: row.kind,
        actorName: row.actorId
          ? ((await ctx.db.get(row.actorId))?.name ?? null)
          : null,
        targetLabel: row.targetLabel,
        targetId: row.targetId,
        at: row.at,
      })),
    );
  },
});
