import type {
  HouseholdJoinRequestView,
  HouseholdPersonView,
  HouseholdSentInviteView,
  HouseholdView,
} from "@jigswap/contracts";
import { resolveHouseholdCopyPermission } from "@jigswap/domain";
import type { Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { query } from "../_generated/server";
import { memberDisplayNameOf } from "../identity/memberDisplayName";
import { requireMember } from "../identity/requireMember";
import { isBlockedEitherWay } from "../social/blocks";
import {
  householdDefaultOf,
  membershipOf,
  membersOfHousehold,
} from "./memberships";

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

// The acting member's household (members + roles), or null. Pending sent invites and requests to
// join are returned to the admin only — they are the one who chose those people and who answers
// the requests. A request to join is listed while pending and not lapsed; a dropped one (asked
// through a link the household's admin did not mint, or across a block) never is. Also the household-wide default copy
// permission (resolved) and how many copies, across ALL members, follow it (no explicit value) —
// what a change of the default would affect.
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
          // An email invitation's in-app invite (viaEmail) is listed only as that invitation
          // (invitations/listMyEmailInvites), never by name: see householdInvites.viaEmail.
          .filter(
            (invite) => invite.status === "pending" && invite.viaEmail !== true,
          )
          .map(async (invite) => ({
            inviteId: invite.aggregateId,
            invitee: await personView(ctx, invite.inviteeId),
            createdAt: invite.createdAt,
          })),
      );
    }

    const joinRequests: HouseholdJoinRequestView[] = [];
    if (membership.role === "admin") {
      const now = Date.now();
      const rows = await ctx.db
        .query("householdJoinRequests")
        .withIndex("by_household_status", (q) =>
          q.eq("householdId", membership.householdId).eq("status", "pending"),
        )
        .collect();
      for (const row of rows.sort((a, b) => a.createdAt - b.createdAt)) {
        if (row.dropped || row.expiresAt <= now) continue;
        if (await isBlockedEitherWay(ctx, viewerId, row.requesterId)) continue;
        joinRequests.push({
          requestId: row.aggregateId,
          requester: await personView(ctx, row.requesterId),
          createdAt: row.createdAt,
        });
      }
    }

    let copiesUsingDefault = 0;
    for (const row of rows) {
      const copies = await ctx.db
        .query("ownedPuzzles")
        .withIndex("by_owner", (q) => q.eq("ownerId", row.memberId))
        .collect();
      copiesUsingDefault += copies.filter(
        (copy) => copy.householdPermission === undefined,
      ).length;
    }

    const household = await ctx.db
      .query("households")
      .withIndex("by_aggregate_id", (q) =>
        q.eq("aggregateId", membership.householdId),
      )
      .unique();

    return {
      householdId: membership.householdId,
      // Only here, behind the viewer's own membership: no other read returns a household's name.
      ...(household?.name !== undefined && { name: household.name }),
      viewerRole: membership.role,
      members,
      pendingInvites,
      joinRequests,
      defaultCopyPermission: resolveHouseholdCopyPermission(
        undefined,
        await householdDefaultOf(ctx, membership.householdId),
      ),
      copiesUsingDefault,
    };
  },
});
