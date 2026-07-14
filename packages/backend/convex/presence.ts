import { Presence } from "@convex-dev/presence";
import { ConvexError, v } from "convex/values";
import { components } from "./_generated/api";
import { mutation, query } from "./_generated/server";
import { requireMember } from "./identity/requireMember";

// The one presence room JigSwap uses: "member is somewhere on /messages". Presence exists to
// suppress out-of-band message notifications for people already looking at the messages surface —
// not as a general who's-online feature (YAGNI).
export const MESSAGES_ROOM = "messages";

export const presence = new Presence(components.presence);

// Heartbeat from the messages layout. The member id comes from auth — the client-supplied
// userId is only validated against it so the shared usePresence hook keeps working; nobody can
// heartbeat someone else into invisibility of notifications.
export const heartbeat = mutation({
  args: {
    roomId: v.string(),
    userId: v.string(),
    sessionId: v.string(),
    interval: v.number(),
  },
  handler: async (ctx, { roomId, userId, sessionId, interval }) => {
    const memberId = await requireMember(ctx);
    if (roomId !== MESSAGES_ROOM)
      throw new ConvexError("Unknown presence room");
    if (userId !== (memberId as string))
      throw new ConvexError("Presence user mismatch");
    return presence.heartbeat(
      ctx,
      roomId,
      memberId as string,
      sessionId,
      interval,
    );
  },
});

// Room-token-scoped read used by the usePresence hook; the token is the capability.
export const list = query({
  args: { roomToken: v.string() },
  handler: (ctx, { roomToken }) => presence.list(ctx, roomToken),
});

// Graceful disconnect via sendBeacon; the session token is the capability (no auth context
// available on beacons).
export const disconnect = mutation({
  args: { sessionToken: v.string() },
  handler: (ctx, { sessionToken }) => presence.disconnect(ctx, sessionToken),
});
