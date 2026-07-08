import { makeReenablePuzzleDefinition } from "@jigswap/domain";
import { ConvexError, v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { mutation } from "../_generated/server";
import { stampModerationAction } from "../admin/stampModerationAction";
import { isAdmin } from "../identity/isAdmin";
import { requireMember } from "../identity/requireMember";
import { runDefinitionAction } from "./runDefinitionAction";

// Moderation: re-enable a DISABLED definition, restoring it to approved (publicly listable
// again). The aggregate enforces the legal approval transition.
export const reenablePuzzleDefinition = mutation({
  args: { puzzleDefinitionId: v.string() },
  handler: async (ctx, args) => {
    const memberId = await requireMember(ctx);
    if (!(await isAdmin(ctx))) throw new ConvexError("Forbidden");
    await runDefinitionAction(
      ctx,
      args.puzzleDefinitionId,
      makeReenablePuzzleDefinition,
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
      kind: "definition_reenabled",
      targetLabel: row?.title ?? args.puzzleDefinitionId,
      targetId: args.puzzleDefinitionId,
    });
  },
});
