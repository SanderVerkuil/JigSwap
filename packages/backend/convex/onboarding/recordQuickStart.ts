import { applyQuickStartChange, type QuickStartChange } from "@jigswap/domain";
import { ConvexError, v } from "convex/values";
import { mutation } from "../_generated/server";
import { requireMemberUser } from "../whatsNew/readState";
import { onboardingRowOf, quickStartStateOf } from "./memberOnboarding";

const stepId = v.union(
  v.literal("puzzles"),
  v.literal("solves"),
  v.literal("people"),
  v.literal("household"),
  v.literal("profile"),
);

// Record a quick start choice for the acting member: skip/unskip a step, dismiss the welcome,
// dismiss/restore the dashboard card, or mark the flow as started (first /welcome visit). `step` is required for skip/unskip and refused otherwise
// (`invalid_change`). Writes only the caller's own row (created lazily) and only when something
// changes, so repeating a call is a no-op.
export const recordQuickStart = mutation({
  args: {
    kind: v.union(
      v.literal("skipStep"),
      v.literal("unskipStep"),
      v.literal("dismissWelcome"),
      v.literal("dismissCard"),
      v.literal("restoreCard"),
      v.literal("startQuickStart"),
    ),
    step: v.optional(stepId),
  },
  handler: async (ctx, { kind, step }): Promise<null> => {
    const member = await requireMemberUser(ctx);
    const change: QuickStartChange | null =
      kind === "skipStep" || kind === "unskipStep"
        ? step === undefined
          ? null
          : { kind, step }
        : step === undefined
          ? { kind }
          : null;
    if (change === null) throw new ConvexError({ code: "invalid_change" });
    const row = await onboardingRowOf(ctx, member._id);
    const now = Date.now();
    const next = applyQuickStartChange(quickStartStateOf(row), change, now);
    if (next === null) return null;
    // Spelled out so a cleared timestamp (restoreCard) is removed from the row.
    const fields = {
      skippedSteps: next.skippedSteps,
      welcomeDismissedAt: next.welcomeDismissedAt,
      cardDismissedAt: next.cardDismissedAt,
      startedAt: next.startedAt,
      updatedAt: now,
    };
    if (row) {
      await ctx.db.patch(row._id, fields);
    } else {
      await ctx.db.insert("memberOnboarding", {
        memberId: member._id,
        ...fields,
      });
    }
    return null;
  },
});
