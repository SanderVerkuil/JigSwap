import type { PresenceView } from "@jigswap/contracts";
import { canSeePresence, effectiveStatus, toMemberId } from "@jigswap/domain";
import { ConvexError, v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { query } from "../_generated/server";
import { isActiveMember } from "../identity/requireActiveMember";
import { requireMember } from "../identity/requireMember";
import { APP_AWAY_ROOM, APP_ONLINE_ROOM, presence } from "../presence";
import { blockedEitherWaySet } from "./blocks";
import { findPresencePreferences } from "./presencePreferences";
import { areMutualFollowers } from "./privacy";

/** The most members one call may ask about (a circle's member cap). */
export const MAX_PRESENCE_TARGETS = 50;

/**
 * Whether a viewer who chose "Appear offline" still sees other members' status. The spec
 * (5.1, Q11) bases reciprocity on sharing only, so they do. Flip this to `false` to make
 * appearing offline also mean seeing nobody (a pending product decision).
 */
export const INVISIBLE_VIEWERS_SEE_OTHERS = true;

// Which of these members the viewer may see as online or away (spec 5.1). Members who are
// offline, hidden, invisible, not mutual, blocked either way, or not sharing are all simply
// ABSENT, so none of those states can be told apart. Never returns lastDisconnected or any other
// timestamp. Reads per target: at most two follow-edge lookups and, for every mutual follower
// not blocked either way, always the same three: their settings row, their user row and the
// component's per-user room list (which changes on transitions, not on every heartbeat, so
// subscribers aren't re-run per heartbeat).
export const getPresenceOf = query({
  args: { memberIds: v.array(v.id("users")) },
  handler: async (ctx, { memberIds }): Promise<PresenceView[]> => {
    const viewerId = (await requireMember(ctx)) as unknown as Id<"users">;
    if (memberIds.length > MAX_PRESENCE_TARGETS) {
      throw new ConvexError({
        code: "TooManyMembers",
        message: `At most ${MAX_PRESENCE_TARGETS} members per call`,
      });
    }
    // A deactivated or tombstoned viewer sees nobody.
    if (!(await isActiveMember(ctx, viewerId))) return [];
    const viewerPrefs = await findPresencePreferences(ctx, viewerId);
    const viewerShare = viewerPrefs?.share;
    // Reciprocity is a canSeePresence clause too; checking it first spares a non-sharing
    // viewer every per-target read.
    if (viewerShare !== true) return [];
    if (!INVISIBLE_VIEWERS_SEE_OTHERS && viewerPrefs?.override === "invisible")
      return [];
    const blocked = await blockedEitherWaySet(ctx, viewerId);

    const views: PresenceView[] = [];
    for (const targetId of new Set(memberIds)) {
      const blockedEitherWay = blocked.has(targetId);
      const mutual =
        !blockedEitherWay &&
        (await areMutualFollowers(ctx, viewerId, targetId));
      // Every target past the relationship gates costs the same reads whatever their settings,
      // activity or account state, so timing can't tell "invisible" or "not sharing" from
      // "offline". (Blocked or non-mutual targets stop here: the follow edges are no secret to
      // the viewer, and a block deletes them anyway.)
      if (!mutual) continue;
      const prefs = await findPresencePreferences(ctx, targetId);
      const target = await ctx.db.get(targetId);
      const rooms = await presence.listUser(ctx, targetId as string, true);
      const targetOverride = prefs?.override ?? "auto";
      const visible =
        canSeePresence({
          viewerId: toMemberId(viewerId),
          targetId: toMemberId(targetId),
          blockedEitherWay,
          mutual,
          targetShare: prefs?.share,
          targetOverride,
          viewerShare,
        }) &&
        // A deleted or deactivated (tombstoned) member is never shown, whatever rows remain.
        target?.isActive === true;
      if (!visible) continue;
      const status = effectiveStatus({
        override: targetOverride,
        inOnlineRoom: rooms.some((room) => room.roomId === APP_ONLINE_ROOM),
        inAwayRoom: rooms.some((room) => room.roomId === APP_AWAY_ROOM),
      });
      if (status !== "offline") views.push({ memberId: targetId, status });
    }
    return views;
  },
});
