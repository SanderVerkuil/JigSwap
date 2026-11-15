import { paginationOptsValidator, type PaginationResult } from "convex/server";
import { v } from "convex/values";
import type { Doc } from "../_generated/dataModel";
import { query } from "../_generated/server";
import { requireAdmin } from "../identity/isAdmin";
import { paginateBounded } from "../lib/pageSize";

// Admin-only, but the page size is still the client's request (the inbox asks for 25).
const MAX_PAGE_SIZE = 50;

// Admin triage read for the marketing contact form inbox, newest first and
// paginated. An optional `status` narrows it to new or handled messages through
// the by_status (status, createdAt) index; without one it pages every message.
// Admin-only (requireAdmin), like the sibling catalog admin reads —
// the table holds visitor names/emails.
export const listContactMessages = query({
  args: {
    paginationOpts: paginationOptsValidator,
    status: v.optional(v.union(v.literal("new"), v.literal("handled"))),
  },
  handler: async (
    ctx,
    args,
  ): Promise<PaginationResult<Doc<"contactMessages">>> => {
    await requireAdmin(ctx);
    const { status } = args;
    return await paginateBounded(
      status
        ? ctx.db
            .query("contactMessages")
            .withIndex("by_status", (q) => q.eq("status", status))
            .order("desc")
        : ctx.db.query("contactMessages").order("desc"),
      args.paginationOpts,
      MAX_PAGE_SIZE,
    );
  },
});
