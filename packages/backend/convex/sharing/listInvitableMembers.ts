import type { InvitableMemberView } from "@jigswap/contracts";
import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { query } from "../_generated/server";
import { requireMember } from "../identity/requireMember";
import { blockedEitherWaySet } from "../social/blocks";
import { projectMemberIdentity } from "../social/privacy";
import {
  openInvitesOf,
  reinviteHeldOff,
  requireCircleAdmin,
} from "./circleAccess";

/** The most candidates one read returns. */
export const MAX_INVITABLE_RESULTS = 50;
/** The most of the Admin's follow edges one read scans. */
export const MAX_FOLLOW_EDGES_SCANNED = 500;

// The members a circle Admin may invite, for the invite picker. Built ONLY from the Admin's own
// mutual follows (the contact rule), never from global search or threads. Drops current members,
// open invitees, anyone inside the re-invite cooldown and anyone blocked either way, and only
// lists members whose identity the Admin may see. `search` narrows by name or username
// (case-insensitive substring).
export const listInvitableMembers = query({
  args: { circleId: v.string(), search: v.optional(v.string()) },
  handler: async (ctx, args): Promise<InvitableMemberView[]> => {
    const viewerId = (await requireMember(ctx)) as unknown as Id<"users">;
    const circle = await requireCircleAdmin(ctx, args.circleId, viewerId);

    const now = Date.now();
    const excluded = new Set<Id<"users">>([
      ...(await reinviteHeldOff(ctx, args.circleId, now)),
      viewerId,
      ...circle.memberships.map((m) => m.memberId),
      ...(await openInvitesOf(ctx, args.circleId, now)).map(
        (invite) => invite.inviteeId,
      ),
      ...(await blockedEitherWaySet(ctx, viewerId)),
    ]);

    // Mutual follows only: members I follow who follow me back. Bounded so a member following
    // thousands of accounts can't make this read unbounded.
    const candidates = new Set<Id<"users">>();
    const following = await ctx.db
      .query("follows")
      .withIndex("by_follower", (q) => q.eq("followerId", viewerId))
      .take(MAX_FOLLOW_EDGES_SCANNED);
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
