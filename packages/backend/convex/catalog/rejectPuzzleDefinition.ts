import { makeRejectPuzzleDefinition } from "@jigswap/domain";
import { ConvexError, v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { mutation } from "../_generated/server";
import { stampModerationAction } from "../admin/stampModerationAction";
import { isAdmin } from "../identity/isAdmin";
import { requireMember } from "../identity/requireMember";
import { runDefinitionAction } from "./runDefinitionAction";

// The longest reason the submitter is sent (the admin console composes a preset plus a note).
export const MAX_REJECTION_REASON = 1000;

// Moderation: reject a pending definition, optionally saying why. The aggregate enforces the legal
// approval transition; the reason rides on PuzzleDefinitionRejected to the submitter's
// puzzle_rejected notification (trimmed; blank means none).
export const rejectPuzzleDefinition = mutation({
  args: { puzzleDefinitionId: v.string(), reason: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const memberId = await requireMember(ctx);
    if (!(await isAdmin(ctx))) throw new ConvexError("Forbidden");

    const reason = args.reason?.trim() || undefined;
    if (reason !== undefined && reason.length > MAX_REJECTION_REASON) {
      throw new ConvexError({
        code: "ReasonTooLong",
        message: `A rejection reason can be at most ${MAX_REJECTION_REASON} characters`,
      });
    }

    await runDefinitionAction(
      ctx,
      args.puzzleDefinitionId,
      (deps) => (cmd) => makeRejectPuzzleDefinition(deps)({ ...cmd, reason }),
    );
    // Audit trail: the domain event carries no actor, so the composition root stamps the
    // decision with the acting admin. The action succeeded, so the row exists.
    const row = await ctx.db
      .query("puzzles")
      .withIndex("by_aggregate_id", (q) =>
        q.eq("aggregateId", args.puzzleDefinitionId),
      )
      .unique();
    await stampModerationAction(ctx, {
      actorId: memberId as unknown as Id<"users">,
      kind: "definition_rejected",
      targetLabel: row?.title ?? args.puzzleDefinitionId,
      targetId: args.puzzleDefinitionId,
    });
  },
});
