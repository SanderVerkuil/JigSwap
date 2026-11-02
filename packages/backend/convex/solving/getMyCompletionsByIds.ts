import { v } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import { query } from "../_generated/server";
import { requireMember } from "../identity/requireMember";
import { COMPLETION_ROWS_MAX } from "./completionLogLimits";
import { enrichCompletions } from "./listMyCompletions";

// Read side for the completion log: the full rows of the solves on screen, in the order asked for.
// The ids come from the client, so each row is checked: only the acting member's own come back, and
// any other id reads as if the solve did not exist, as does a deleted one. At most
// COMPLETION_ROWS_MAX ids, repeats counted once.
export const getMyCompletionsByIds = query({
  args: { completionIds: v.array(v.id("completions")) },
  handler: async (ctx, args) => {
    const me = (await requireMember(ctx)) as unknown as Id<"users">;
    const ids = [...new Set(args.completionIds)].slice(0, COMPLETION_ROWS_MAX);
    const rows = await Promise.all(ids.map((id) => ctx.db.get(id)));
    const own = rows.filter(
      (row): row is Doc<"completions"> => row !== null && row.userId === me,
    );
    return enrichCompletions(ctx, me, own);
  },
});
