import { ConvexError, v } from "convex/values";
import { mutation } from "../_generated/server";
import { isAdmin } from "../identity/isAdmin";
import { requireMember } from "../identity/requireMember";

export const CSAM_ESCALATION_NOTE_MAX = 2000;

// Admin-only: record what the operator did with a CSAM escalation: "reported" (to Meldpunt
// Offlimits or the police; stamps reportedAt the first time), "closed", or back to "open", plus
// an optional note (e.g. the report reference). Never touches the quarantined image or its blob.
export const markCsamEscalation = mutation({
  args: {
    id: v.id("csamEscalations"),
    status: v.union(
      v.literal("open"),
      v.literal("reported"),
      v.literal("closed"),
    ),
    note: v.optional(v.string()),
  },
  handler: async (ctx, { id, status, note }) => {
    await requireMember(ctx);
    if (!(await isAdmin(ctx))) throw new ConvexError("Forbidden");

    const row = await ctx.db.get(id);
    if (!row) throw new ConvexError("Escalation not found");
    const trimmed = note?.trim();
    if (trimmed && trimmed.length > CSAM_ESCALATION_NOTE_MAX) {
      throw new ConvexError("Note is too long");
    }
    await ctx.db.patch(id, {
      status,
      reportedAt:
        status === "reported" ? (row.reportedAt ?? Date.now()) : row.reportedAt,
      // An omitted note keeps the existing one; an empty note clears it.
      ...(note === undefined ? {} : { note: trimmed || undefined }),
    });
  },
});
