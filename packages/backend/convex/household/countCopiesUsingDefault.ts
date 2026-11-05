import type { Id } from "../_generated/dataModel";
import { query } from "../_generated/server";
import { requireMember } from "../identity/requireMember";
import { LIBRARY_COUNT_SCAN_CAP } from "../library/memberLibraryCounts";
import { newestCopiesOf } from "../library/myLibraryRows";
import { membershipOf, membersOfHousehold } from "./memberships";

// How many copies across ALL the household's members follow its default permission (no explicit
// value of their own): what a change of the default would affect. For the household's settings
// panel, the one place that says it, and on its own so nothing else pays for it: no index holds this,
// so it reads the copies, and re-runs on every copy written in the household. Past
// LIBRARY_COUNT_SCAN_CAP copies (newest first) it undercounts rather than fails. null outside a
// household.
export const countCopiesUsingDefault = query({
  args: {},
  handler: async (ctx): Promise<number | null> => {
    const viewerId = (await requireMember(ctx)) as unknown as Id<"users">;
    const membership = await membershipOf(ctx, viewerId);
    if (!membership) return null;
    const members = await membersOfHousehold(ctx, membership.householdId);
    const copies = await newestCopiesOf(
      ctx,
      members.map((row) => row.memberId),
      LIBRARY_COUNT_SCAN_CAP,
    );
    return copies.filter((copy) => copy.householdPermission === undefined)
      .length;
  },
});
