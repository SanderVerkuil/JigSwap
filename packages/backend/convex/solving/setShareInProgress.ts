import { makeSetShareInProgress, type MemberId } from "@jigswap/domain";
import { v } from "convex/values";
import { mutation } from "../_generated/server";
import { requireMember } from "../identity/requireMember";
import { convexSolvingPreferencesRepository } from "./adapters/convexSolvingPreferencesRepository";
import { systemClock } from "./adapters/systemClock";

// Composition root: the member sets their own in-progress-sharing preference (member from auth).
export const setShareInProgress = mutation({
  args: { enabled: v.boolean() },
  handler: async (ctx, args) => {
    const memberId = await requireMember(ctx);
    const setShareUseCase = makeSetShareInProgress({
      preferences: convexSolvingPreferencesRepository(ctx),
      clock: systemClock,
    });
    await setShareUseCase({
      memberId: memberId as unknown as MemberId,
      enabled: args.enabled,
    });
  },
});
