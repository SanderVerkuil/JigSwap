import type { GlobalStatsView } from "@jigswap/contracts";
import { query } from "../_generated/server";
import { readPlatformStats } from "./platformStats";

// Insights read (thin adapter): platform-wide counters for the public landing page. Counts match
// legacy users.getGlobalStats exactly (members, catalog definitions, owned copies). Reads the one
// platformStats row that insights/platformStats.recount rewrites every 6 hours (PERF-B2m), so the
// page's cost no longer grows with the tables and its numbers may be up to one recount old. Until
// the first recount has written the row, it counts the tables itself (the old full-table cost).
export const getGlobalStats = query({
  args: {},
  handler: async (ctx): Promise<GlobalStatsView> => {
    const stats = await readPlatformStats(ctx);
    if (stats) {
      return {
        totalUsers: stats.users,
        totalPuzzles: stats.puzzles,
        totalOwnedPuzzles: stats.ownedPuzzles,
      };
    }

    const [users, puzzles, ownedPuzzles] = await Promise.all([
      ctx.db.query("users").collect(),
      ctx.db.query("puzzles").collect(),
      ctx.db.query("ownedPuzzles").collect(),
    ]);

    return {
      totalUsers: users.length,
      totalPuzzles: puzzles.length,
      totalOwnedPuzzles: ownedPuzzles.length,
    };
  },
});
