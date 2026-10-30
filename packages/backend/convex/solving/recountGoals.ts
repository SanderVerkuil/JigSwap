import {
  countTowardGoal,
  goalCountingWindow,
  type GoalSolve,
  type MemberId,
} from "@jigswap/domain";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { internalMutation } from "../_generated/server";
import { convexCompletionRepository } from "./adapters/convexCompletionRepository";

// Goals per batch. Each goal is one read plus at most one patch, and each distinct member in the
// batch adds one read of their finished solves (cached for the batch), well inside Convex's
// per-mutation limits for this app's sizes.
export const RECOUNT_GOALS_BATCH = 100;

type Counts = { scanned: number; changed: number };

// One-shot, idempotent migration to period-scoped goal progress (UX-42): every `goals` row gets
// `currentCompletions` = the number of its member's finished solves inside its counting window
// (goalCountingWindow + countTowardGoal, the same rule the live recompute uses). Goals set before
// periods existed have no startDate, so they count from the day they were created; their old
// lifetime totals come down. Archived goals are recounted too, so no stored count is above its
// period. Only `currentCompletions` is written (not `updatedAt`: this is not a member's edit) and
// no domain event is recorded, so a corrected goal never sends a GoalAchieved notification. Rows
// whose count is already right are skipped, so a second run changes nothing. Pages through the
// table and reschedules itself until it is exhausted; each batch is its own transaction.
// `dryRun` walks every page and counts without writing. Runbook:
// docs/deployment/one-shot-migrations.md.
export const recountGoals = internalMutation({
  args: {
    cursor: v.optional(v.union(v.string(), v.null())),
    dryRun: v.optional(v.boolean()),
    // Running totals carried across batches so the final batch logs the whole run.
    totals: v.optional(v.object({ scanned: v.number(), changed: v.number() })),
  },
  handler: async (ctx, { cursor, dryRun, totals }): Promise<Counts> => {
    const page = await ctx.db.query("goals").paginate({
      numItems: RECOUNT_GOALS_BATCH,
      cursor: cursor ?? null,
    });

    const completions = convexCompletionRepository(ctx);
    const solvesOf = new Map<Id<"users">, readonly GoalSolve[]>();
    const batch: Counts = { scanned: 0, changed: 0 };
    for (const row of page.page) {
      batch.scanned++;
      let solves = solvesOf.get(row.userId);
      if (solves === undefined) {
        solves = await completions.listGoalSolves(
          row.userId as unknown as MemberId,
        );
        solvesOf.set(row.userId, solves);
      }
      const count = countTowardGoal(
        solves,
        goalCountingWindow({
          startDate:
            row.startDate === undefined ? undefined : new Date(row.startDate),
          createdAt: new Date(row.createdAt),
          targetDate:
            row.targetDate === undefined ? undefined : new Date(row.targetDate),
        }),
      );
      if (count === row.currentCompletions) continue;
      batch.changed++;
      if (!dryRun) await ctx.db.patch(row._id, { currentCompletions: count });
    }

    const runTotals: Counts = {
      scanned: (totals?.scanned ?? 0) + batch.scanned,
      changed: (totals?.changed ?? 0) + batch.changed,
    };
    console.log(
      `solving/recountGoals${dryRun ? " (dry run)" : ""} batch`,
      JSON.stringify({ ...batch, totals: runTotals, isDone: page.isDone }),
    );

    if (!page.isDone) {
      await ctx.scheduler.runAfter(
        0,
        internal.solving.recountGoals.recountGoals,
        {
          cursor: page.continueCursor,
          totals: runTotals,
          ...(dryRun ? { dryRun } : {}),
        },
      );
    }
    return batch;
  },
});
