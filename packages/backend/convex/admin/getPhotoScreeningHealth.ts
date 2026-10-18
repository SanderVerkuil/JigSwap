import { ConvexError } from "convex/values";
import { query } from "../_generated/server";
import { isAdmin } from "../identity/isAdmin";
import { requireMember } from "../identity/requireMember";
import { readScreeningConfig } from "../library/adapters/photoModeration";

// Counts stop here; the indicator renders "100+" — past that the number carries no more signal.
export const SCREENING_HEALTH_COUNT_CAP = 100;

// Admin-only health of automated photo screening, for the moderation page's indicator. From env it
// reports the selected provider and whether its credentials are present — the NAMES of any missing
// env vars, NEVER a value;
// from the data, how many copy/completion photos are currently "unscored" (the classifier could not
// check them, so they are visible to their uploader only). A rising unscored count means the
// provider is down or misconfigured; the per-attempt `screening_outcome` logs say why.
export const getPhotoScreeningHealth = query({
  args: {},
  handler: async (ctx) => {
    await requireMember(ctx);
    if (!(await isAdmin(ctx))) throw new ConvexError("Forbidden");

    const config = readScreeningConfig(process.env);
    const unscoredCopyPhotos = (
      await ctx.db
        .query("ownedPuzzleImages")
        .withIndex("by_moderation_status", (q) =>
          q.eq("moderationStatus", "unscored"),
        )
        .take(SCREENING_HEALTH_COUNT_CAP)
    ).length;
    const unscoredCompletionPhotos = (
      await ctx.db
        .query("completionImages")
        .withIndex("by_moderation_status", (q) =>
          q.eq("moderationStatus", "unscored"),
        )
        .take(SCREENING_HEALTH_COUNT_CAP)
    ).length;
    return {
      status: config.status,
      provider: config.provider,
      model: config.model,
      tokenConfigured: config.tokenConfigured,
      // Names only (e.g. "SIGHTENGINE_SECRET_KEY"), never values.
      missingVars: config.missingVars,
      unscoredCopyPhotos,
      unscoredCompletionPhotos,
      countCap: SCREENING_HEALTH_COUNT_CAP,
    };
  },
});
