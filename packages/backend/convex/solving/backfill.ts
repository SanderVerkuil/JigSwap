import { internalMutation } from "../_generated/server";

// One-shot, idempotent migration so the new domain-driven Solving functions (which look up by
// aggregateId) can act on legacy rows: stamp aggregateId on every completions/goals row missing
// one. Re-runnable: rows that already carry the field are skipped. The new functions stay dormant
// until the 3d UI ships regardless.
export const backfillSolving = internalMutation({
  args: {},
  handler: async (ctx) => {
    let completionsStamped = 0;
    let goalsStamped = 0;

    const completions = await ctx.db.query("completions").collect();
    for (const completion of completions) {
      if (completion.aggregateId) continue;
      await ctx.db.patch(completion._id, { aggregateId: crypto.randomUUID() });
      completionsStamped++;
    }

    const goals = await ctx.db.query("goals").collect();
    for (const goal of goals) {
      if (goal.aggregateId) continue;
      await ctx.db.patch(goal._id, { aggregateId: crypto.randomUUID() });
      goalsStamped++;
    }

    return { completionsStamped, goalsStamped };
  },
});
