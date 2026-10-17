import type {
  HouseholdPersonView,
  HouseholdSentInviteView,
  HouseholdView,
} from "@jigswap/contracts";
import type { Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { query } from "../_generated/server";
import { memberDisplayNameOf } from "../identity/memberDisplayName";
import { requireMember } from "../identity/requireMember";
import { membershipOf, membersOfHousehold } from "./memberships";

export const personView = async (
  ctx: QueryCtx,
  memberId: Id<"users">,
): Promise<HouseholdPersonView> => {
  const user = await ctx.db.get(memberId);
  // Shared resolver (account name, else username — never the email); absent when the member has
  // no identifiable name, and the web renders its localized generic label.
  const name = memberDisplayNameOf(user);
  return {
    memberId: memberId as string,
    ...(name ? { name } : {}),
    ...(user?.avatar ? { avatar: user.avatar } : {}),
  };
};

// The acting member's household (members + roles), or null. Pending sent invites are returned to
// the admin only — they are the one who chose those people.
export const getMyHousehold = query({
  args: {},
  handler: async (ctx): Promise<HouseholdView | null> => {
    const viewerId = (await requireMember(ctx)) as unknown as Id<"users">;
    const membership = await membershipOf(ctx, viewerId);
    if (!membership) return null;

    const rows = await membersOfHousehold(ctx, membership.householdId);
    const members = await Promise.all(
      rows
        .slice()
        .sort((a, b) => a.joinedAt - b.joinedAt)
        .map(async (row) => ({
          ...(await personView(ctx, row.memberId)),
          role: row.role,
          joinedAt: row.joinedAt,
          isYou: row.memberId === viewerId,
        })),
    );

    let pendingInvites: HouseholdSentInviteView[] = [];
    if (membership.role === "admin") {
      const invites = await ctx.db
        .query("householdInvites")
        .withIndex("by_household", (q) =>
          q.eq("householdId", membership.householdId),
        )
        .collect();
      pendingInvites = await Promise.all(
        invites
          .filter((invite) => invite.status === "pending")
          .map(async (invite) => ({
            inviteId: invite.aggregateId,
            invitee: await personView(ctx, invite.inviteeId),
            createdAt: invite.createdAt,
          })),
      );
    }

    return {
      householdId: membership.householdId,
      viewerRole: membership.role,
      members,
      pendingInvites,
    };
  },
});
