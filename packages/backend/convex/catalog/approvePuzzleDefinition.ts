import { makeApprovePuzzleDefinition } from "@jigswap/domain";
import { ConvexError, v } from "convex/values";
import { mutation } from "../_generated/server";
import { isAdmin } from "../identity/isAdmin";
import { requireMember } from "../identity/requireMember";
import { runDefinitionAction } from "./runDefinitionAction";

// Moderation: approve a pending definition, making it publicly listable. The aggregate enforces
// the legal approval transition.
export const approvePuzzleDefinition = mutation({
  args: { puzzleDefinitionId: v.string() },
  handler: async (ctx, args) => {
    await requireMember(ctx);
    if (!(await isAdmin(ctx))) throw new ConvexError("Forbidden");
    await runDefinitionAction(
      ctx,
      args.puzzleDefinitionId,
      makeApprovePuzzleDefinition,
    );
  },
});
