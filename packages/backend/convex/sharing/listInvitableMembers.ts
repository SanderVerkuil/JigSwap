import type { InvitableMemberView } from "@jigswap/contracts";
import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { query } from "../_generated/server";
import { requireMember } from "../identity/requireMember";
import { blockedEitherWaySet } from "../social/blocks";
import { projectMemberIdentity } from "../social/privacy";
import { openInvitesOf, requireCircleAdmin } from "./circleAccess";

/** The most candidates one read returns. */
export const MAX_INVITABLE_RESULTS = 50;

// The members a circle Admin may invite, for the invite picker. Built ONLY from the Admin's own
// contacts (mutual follows plus partners of an existing pair thread), never from global search,
// so it lists exactly the contact rule's candidates. Drops current members, open invitees and
// anyone blocked either way, and only lists members whose identity the Admin may see (an
// anonymised candidate could not be told apart, so it is not offered). `search` narrows by name or
// username (case-insensitive substring).
export const listInvitableMembers = query({
  args: { circleId: v.string(), search: v.optional(v.string()) },
  handler: async (ctx, args): Promise<InvitableMemberView[]> => {
    const viewerId = (await requireMember(ctx)) as unknown as Id<"users">;
    const circle = await requireCircleAdmin(ctx, args.circleId, viewerId);

    const excluded = new Set<Id<"users">>([
      viewerId,
      ...circle.memberships.map((m) => m.memberId),
      ...(await openInvitesOf(ctx, args.circleId, Date.now())).map(
        (invite) => invite.inviteeId,
      ),
      ...(await blockedEitherWaySet(ctx, viewerId)),
    ]);

    const candidates = new Set<Id<"users">>();
    // Mutual follows: members I follow who follow me back.
    const following = await ctx.db
      .query("follows")
      .withIndex("by_follower", (q) => q.eq("followerId", viewerId))
      .collect();
    for (const edge of following) {
      if (excluded.has(edge.followeeId)) continue;
      const back = await ctx.db
        .query("follows")
        .withIndex("by_follower_followee", (q) =>
          q.eq("followerId", edge.followeeId).eq("followeeId", viewerId),
        )
        .first();
      if (back) candidates.add(edge.followeeId);
    }
    // Partners of an existing pair thread.
    const threads = await ctx.db
      .query("threadParticipants")
      .withIndex("by_member", (q) => q.eq("memberId", viewerId))
      .collect();
    for (const link of threads) {
      const thread = await ctx.db
        .query("threads")
        .withIndex("by_aggregate_id", (q) =>
          q.eq("aggregateId", link.threadAggregateId),
        )
        .first();
      if (!thread || thread.participants.length !== 2) continue;
      const other = thread.participants.find((p) => p !== viewerId);
      if (other && !excluded.has(other)) candidates.add(other);
    }

    const needle = args.search?.trim().toLowerCase() ?? "";
    const results: InvitableMemberView[] = [];
    for (const memberId of candidates) {
      if (results.length >= MAX_INVITABLE_RESULTS) break;
      const projected = await projectMemberIdentity(
        ctx,
        viewerId,
        memberId,
        args.circleId,
      );
      if (projected.anonymous || !projected.member.isActive) continue;
      const { name, username } = projected.member;
      if (
        needle &&
        !(name ?? "").toLowerCase().includes(needle) &&
        !(username ?? "").toLowerCase().includes(needle)
      ) {
        continue;
      }
      results.push(projected);
    }
    return results;
  },
});
