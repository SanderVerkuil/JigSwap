import type { GlobalStatsView } from "@jigswap/contracts";
import { query } from "../_generated/server";

// Insights read (thin adapter): platform-wide counters for the public landing page. Counts match
// legacy users.getGlobalStats exactly (members, catalog definitions, owned copies).
export const getGlobalStats = query({
  args: {},
  handler: async (ctx): Promise<GlobalStatsView> => {
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
