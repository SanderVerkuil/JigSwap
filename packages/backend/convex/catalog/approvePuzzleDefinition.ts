import { makeApprovePuzzleDefinition } from "@jigswap/domain";
import { ConvexError, v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { mutation } from "../_generated/server";
import { stampModerationAction } from "../admin/stampModerationAction";
import { isAdmin } from "../identity/isAdmin";
import { requireMember } from "../identity/requireMember";
import { runDefinitionAction } from "./runDefinitionAction";

// Moderation: approve a pending definition, making it publicly listable. The aggregate enforces
// the legal approval transition.
export const approvePuzzleDefinition = mutation({
  args: {
    puzzleDefinitionId: v.string(),
    // True when the admin edited the definition before approving (Edit&Approve flow); the audit
    // stamp then records `definition_edited_approved` instead of a plain approval.
    edited: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const memberId = await requireMember(ctx);
    if (!(await isAdmin(ctx))) throw new ConvexError("Forbidden");
    await runDefinitionAction(
      ctx,
      args.puzzleDefinitionId,
      makeApprovePuzzleDefinition,
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
      kind: args.edited ? "definition_edited_approved" : "definition_approved",
      targetLabel: row?.title ?? args.puzzleDefinitionId,
      targetId: args.puzzleDefinitionId,
    });
  },
});
