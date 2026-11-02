import type { MySolveStateView } from "@jigswap/contracts";
import type { Id } from "../_generated/dataModel";
import { query } from "../_generated/server";
import { requireMember } from "../identity/requireMember";

// How many finished solves this read covers, newest first. No real member comes close; past it the
// oldest finished solves no longer mark their copies. Solves in progress are read on their own, so
// they always count.
export const SOLVE_STATE_READ_CAP = 5000;

// The acting member's solve log reduced to what a copy needs to know about it: per copy, whether a
// solve on it is finished or in progress, and which in-progress solve to finish (the newest started
// with an aggregateId; a legacy row without one can't be finished). For the library's In Progress and
// Completed pills, its Start/Finish action and "already solved" marks. It reads the completion rows
// only: no copies, puzzles, covers or photos, so it stays cheap at a size listMyCompletions can't.
export const listMySolveStates = query({
  args: {},
  handler: async (ctx): Promise<MySolveStateView[]> => {
    const me = (await requireMember(ctx)) as unknown as Id<"users">;
    const slice = (isCompleted: boolean) =>
      ctx.db
        .query("completions")
        .withIndex("by_user_completed", (q) =>
          q.eq("userId", me).eq("isCompleted", isCompleted),
        )
        .order("desc")
        .take(SOLVE_STATE_READ_CAP);
    const [inProgress, finished] = await Promise.all([
      slice(false),
      slice(true),
    ]);

    const states = new Map<string, MySolveStateView>();
    const stateOf = (copyId: string) => {
      const known = states.get(copyId);
      if (known) return known;
      const state: MySolveStateView = {
        copyId,
        completed: false,
        inProgress: false,
      };
      states.set(copyId, state);
      return state;
    };
    for (const row of finished) {
      if (row.ownedPuzzleId) stateOf(row.ownedPuzzleId).completed = true;
    }
    for (const row of inProgress) {
      if (!row.ownedPuzzleId) continue;
      const state = stateOf(row.ownedPuzzleId);
      state.inProgress = true;
      if (
        row.aggregateId &&
        (state.inProgressStartDate === undefined ||
          row.startDate > state.inProgressStartDate)
      ) {
        state.inProgressCompletionId = row.aggregateId;
        state.inProgressStartDate = row.startDate;
      }
    }
    return [...states.values()];
  },
});
