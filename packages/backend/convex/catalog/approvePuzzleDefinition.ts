import { makeApprovePuzzleDefinition } from "@jigswap/domain";
import { v } from "convex/values";
import { mutation } from "../_generated/server";
import { requireMember } from "../identity/requireMember";
import { runDefinitionAction } from "./runDefinitionAction";

// Moderation: approve a pending definition, making it publicly listable. The aggregate enforces
// the legal approval transition.
export const approvePuzzleDefinition = mutation({
  args: { puzzleDefinitionId: v.string() },
  handler: async (ctx, args) => {
    await requireMember(ctx);
    await runDefinitionAction(ctx, args.puzzleDefinitionId, makeApprovePuzzleDefinition);
  },
});
