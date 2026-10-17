import { STANDALONE_TOUR_IDS } from "@jigswap/contracts";
import { ConvexError, v } from "convex/values";
import { mutation } from "../_generated/server";
import { whatsNewManifest } from "./manifest";
import { requireMemberUser } from "./readState";

// Tours are short; a step index at or past this is a client bug.
export const MAX_TOUR_STEPS = 50;

// Save where the acting member is in a tour (started/paused at `step`, completed, or dismissed).
// Last write wins, so replaying a completed tour moves it back to in_progress. Unlike entry ids,
// an unknown tour id is rejected: this is an explicit write of a row, not a fire-and-forget mark.
// Known ids are those a manifest entry references plus the registered STANDALONE_TOUR_IDS.
export const recordTourProgress = mutation({
  args: {
    tourId: v.string(),
    status: v.union(
      v.literal("in_progress"),
      v.literal("completed"),
      v.literal("dismissed"),
    ),
    step: v.optional(v.number()),
  },
  handler: async (ctx, { tourId, status, step }) => {
    const member = await requireMemberUser(ctx);
    const known =
      (STANDALONE_TOUR_IDS as readonly string[]).includes(tourId) ||
      whatsNewManifest().some((entry) => entry.tour === tourId);
    if (!known) {
      throw new ConvexError({ code: "unknown_tour" });
    }
    const validStep =
      step === undefined
        ? status !== "in_progress"
        : Number.isInteger(step) && step >= 0 && step < MAX_TOUR_STEPS;
    if (!validStep) throw new ConvexError({ code: "invalid_step" });

    const existing = await ctx.db
      .query("whatsNewTourProgress")
      .withIndex("by_member_tour", (q) =>
        q.eq("memberId", member._id).eq("tourId", tourId),
      )
      .unique();
    const fields = { status, step, updatedAt: Date.now() };
    if (existing) {
      await ctx.db.patch(existing._id, fields);
    } else {
      await ctx.db.insert("whatsNewTourProgress", {
        memberId: member._id,
        tourId,
        ...fields,
      });
    }
  },
});
