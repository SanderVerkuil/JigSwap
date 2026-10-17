import type { QuickStartState } from "@jigswap/domain";
import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";

// The member's quick start row, or null when they have never skipped or dismissed anything.
export const onboardingRowOf = (
  ctx: QueryCtx,
  memberId: Id<"users">,
): Promise<Doc<"memberOnboarding"> | null> =>
  ctx.db
    .query("memberOnboarding")
    .withIndex("by_member", (q) => q.eq("memberId", memberId))
    .unique();

export const quickStartStateOf = (
  row: Doc<"memberOnboarding"> | null,
): QuickStartState => ({
  skippedSteps: row?.skippedSteps ?? [],
  ...(row?.welcomeDismissedAt !== undefined
    ? { welcomeDismissedAt: row.welcomeDismissedAt }
    : {}),
  ...(row?.cardDismissedAt !== undefined
    ? { cardDismissedAt: row.cardDismissedAt }
    : {}),
  ...(row?.startedAt !== undefined ? { startedAt: row.startedAt } : {}),
});
