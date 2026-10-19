import type { EmailInviteView } from "@jigswap/contracts";
import type { Id } from "../_generated/dataModel";
import { query } from "../_generated/server";
import { membershipOf } from "../household/memberships";
import { requireMember } from "../identity/requireMember";

// Read side for the household admin's pending list: every pending email invitation to the
// admin's household, whoever of its admins sent it (so a new admin after a handover sees and can
// revoke the ones sent before), newest first. Like listMyEmailInvites a row carries no address and
// nothing about who it reached. Empty for anyone who is not the household's admin. Lapsed rows
// (past expiresAt, expiry not yet run) are left out.
export const listHouseholdEmailInvites = query({
  args: {},
  handler: async (ctx): Promise<EmailInviteView[]> => {
    const me = (await requireMember(ctx)) as unknown as Id<"users">;
    const membership = await membershipOf(ctx, me);
    if (membership?.role !== "admin") return [];
    const now = Date.now();
    const rows = await ctx.db
      .query("emailInvites")
      .withIndex("by_household", (q) =>
        q.eq("householdId", membership.householdId),
      )
      .order("desc")
      .collect();
    return rows
      .filter((row) => row.kind === "household" && row.expiresAt > now)
      .map((row) => ({
        inviteRef: row.aggregateId,
        kind: row.kind,
        createdAt: row.createdAt,
        expiresAt: row.expiresAt,
      }));
  },
});
