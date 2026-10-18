import { ConvexError, v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { mutation } from "../_generated/server";
import { isAdmin } from "../identity/isAdmin";
import { requireMember } from "../identity/requireMember";
import { stampModerationAction } from "./stampModerationAction";

export const CSAM_ESCALATION_NOTE_MAX = 2000;

type EscalationStatus = "open" | "reported" | "closed";

// The only forward steps: open -> reported -> closed. Staying put is allowed to add a note.
const NEXT: Record<EscalationStatus, EscalationStatus | null> = {
  open: "reported",
  reported: "closed",
  closed: null,
};

// Admin-only: record what the operator did with a CSAM escalation. Status moves only
// open -> reported (stamps reportedAt) -> closed (only once reported); repeating the current
// status just adds a note. Notes are append-only ({ at, actorId, text }), never edited or
// removed. Every call is stamped on the audit trail with the admin as actor. Never touches the
// quarantined image or its blob.
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
    const memberId = (await requireMember(ctx)) as unknown as Id<"users">;
    if (!(await isAdmin(ctx))) throw new ConvexError("Forbidden");

    const row = await ctx.db.get(id);
    if (!row) throw new ConvexError("Escalation not found");
    const text = note?.trim();
    if (text && text.length > CSAM_ESCALATION_NOTE_MAX) {
      throw new ConvexError("Note is too long");
    }
    const moving = status !== row.status;
    if (moving && NEXT[row.status] !== status) {
      throw new ConvexError(`Cannot go from ${row.status} to ${status}`);
    }
    if (status === "closed" && moving && row.reportedAt === undefined) {
      throw new ConvexError("Report the escalation before closing it");
    }
    if (!moving && !text) return;

    const now = Date.now();
    await ctx.db.patch(id, {
      status,
      ...(status === "reported" && moving ? { reportedAt: now } : {}),
      ...(text
        ? {
            notes: [...(row.notes ?? []), { at: now, actorId: memberId, text }],
          }
        : {}),
    });
    await stampModerationAction(ctx, {
      actorId: memberId,
      kind: "csam_escalation_updated",
      targetLabel: moving ? status : "note",
      targetId: id,
    });
  },
});
