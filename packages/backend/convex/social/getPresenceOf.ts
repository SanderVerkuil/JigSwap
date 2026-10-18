import type { PresenceView } from "@jigswap/contracts";
import { canSeePresence, effectiveStatus, toMemberId } from "@jigswap/domain";
import { ConvexError, v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { query } from "../_generated/server";
import { requireMember } from "../identity/requireMember";
import { APP_AWAY_ROOM, APP_ONLINE_ROOM, presence } from "../presence";
import { blockedEitherWaySet } from "./blocks";
import { findPresencePreferences } from "./presencePreferences";
import { areMutualFollowers } from "./privacy";

/** The most members one call may ask about (a circle's member cap). */
export const MAX_PRESENCE_TARGETS = 50;

// Which of these members the viewer may see as online or away (spec 5.1). Members who are
// offline, hidden, invisible, not mutual, blocked either way, or not sharing are all simply
// ABSENT, so none of those states can be told apart. Never returns lastDisconnected or any other
// timestamp. Reads per target: their settings row, at most two follow-edge lookups and, only
// when visible, their user row and the component's per-user room list (which changes on
// transitions, not on every heartbeat, so subscribers aren't re-run per heartbeat).
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
    const viewerShare = (await findPresencePreferences(ctx, viewerId))?.share;
    // Reciprocity is a canSeePresence clause too; checking it first spares a non-sharing
    // viewer every per-target read.
    if (viewerShare !== true) return [];
    const blocked = await blockedEitherWaySet(ctx, viewerId);

    const views: PresenceView[] = [];
    for (const targetId of new Set(memberIds)) {
      const prefs = await findPresencePreferences(ctx, targetId);
      const targetOverride = prefs?.override ?? "auto";
      const visible = canSeePresence({
        viewerId: toMemberId(viewerId),
        targetId: toMemberId(targetId),
        blockedEitherWay: blocked.has(targetId),
        mutual: await areMutualFollowers(ctx, viewerId, targetId),
        targetShare: prefs?.share,
        targetOverride,
        viewerShare,
      });
      if (!visible) continue;
      // A deleted or deactivated (tombstoned) member is never shown, whatever rows remain.
      const target = await ctx.db.get(targetId);
      if (!target || !target.isActive) continue;
      const rooms = await presence.listUser(ctx, targetId as string, true);
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
