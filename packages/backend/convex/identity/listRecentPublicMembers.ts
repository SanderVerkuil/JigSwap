import type { MemberView } from "@jigswap/contracts";
import type { Id } from "../_generated/dataModel";
import { query } from "../_generated/server";
import { profileVisibilityOf } from "../social/privacy";
import { requireMember } from "./requireMember";
import { toMemberView } from "./toMemberView";

// Identity read (thin adapter): the "Recently joined" seed for the Find-people tab — up to 5 of
// the newest members, PUBLIC profiles only (the privacy chokepoint gates every candidate), never
// the viewer themself, never inactive accounts. Newest-first via Convex's _creationTime ordering;
// we over-scan a bounded window because private/inactive candidates get dropped by the gate.
const LIMIT = 5;
const SCAN_LIMIT = 50;

export const listRecentPublicMembers = query({
  args: {},
  handler: async (ctx): Promise<MemberView[]> => {
    const viewerId = (await requireMember(ctx)) as unknown as Id<"users">;

    const candidates = await ctx.db
      .query("users")
      .order("desc")
      .take(SCAN_LIMIT);

    const results: MemberView[] = [];
    for (const u of candidates) {
      if (results.length >= LIMIT) break;
      if (u._id === viewerId) continue;
      if (u.isActive === false) continue;
      if ((await profileVisibilityOf(ctx, u._id)) !== "public") continue;
      results.push(toMemberView(u));
    }
    return results;
  },
});
