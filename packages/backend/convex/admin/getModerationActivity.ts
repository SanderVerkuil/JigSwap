import { ConvexError, v } from "convex/values";
import { query } from "../_generated/server";
import { isAdmin } from "../identity/isAdmin";
import { requireMember } from "../identity/requireMember";
import { clampLimit } from "../lib/pageSize";
import { toAuditEntry } from "./auditEntry";

// Admin-only, but the size is still the client's request: default 30 rows, at most 100.
const DEFAULT_LIMIT = 30;
const MAX_LIMIT = 100;

// Activity feed for the moderation console: the latest moderation decisions, newest first,
// with the acting admin's display name joined in (null = automated pipeline) and a targeted
// member's label resolved now (admin/auditEntry). Admin-only, gated exactly like
// listPendingPuzzleDefinitions.
export const getModerationActivity = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit }) => {
    await requireMember(ctx);
    if (!(await isAdmin(ctx))) throw new ConvexError("Forbidden");

    const rows = await ctx.db
      .query("moderationActions")
      .withIndex("by_at")
      .order("desc")
      .take(clampLimit(limit, { fallback: DEFAULT_LIMIT, max: MAX_LIMIT }));

    return Promise.all(rows.map((row) => toAuditEntry(ctx, row)));
  },
});
