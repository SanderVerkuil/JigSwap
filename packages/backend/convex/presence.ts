import { Presence } from "@convex-dev/presence";
import { ConvexError, v } from "convex/values";
import { components } from "./_generated/api";
import { mutation, query } from "./_generated/server";
import { requireActiveMember } from "./identity/requireActiveMember";
import { logEvent } from "./lib/logEvent";
import { enforceRateLimit } from "./lib/rateLimits";

// The presence rooms JigSwap allows. "messages": the member is somewhere on /messages, which
// suppresses out-of-band message notifications (notifications/presenceGate). "app:online" /
// "app:away": a visible dashboard tab that is active / idle, read only through
// social/getPresenceOf, which applies the opt-in, mutual-only visibility rule.
export const MESSAGES_ROOM = "messages";
export const APP_ONLINE_ROOM = "app:online";
export const APP_AWAY_ROOM = "app:away";
export const PRESENCE_ROOMS: readonly string[] = [
  MESSAGES_ROOM,
  APP_ONLINE_ROOM,
  APP_AWAY_ROOM,
];

export const presence = new Presence(components.presence);

// Bounds on the client-supplied heartbeat interval. The component sets the session deadline to
// interval × 2.5, so an unbounded value would keep a session online forever (or, for NaN or a
// negative number, hand the disconnect worker a deadline it can never settle).
export const MIN_HEARTBEAT_INTERVAL_MS = 5_000;
export const MAX_HEARTBEAT_INTERVAL_MS = 60_000;
// One heartbeat in this many emits the bandwidth wide event (sample_rate on the line).
export const HEARTBEAT_LOG_SAMPLE_RATE = 10;

// The usePresence hook's sessionId is JSON of [uuid, roomId, userId], well under this.
const MAX_SESSION_ID_LENGTH = 200;

// Heartbeat from the messages layout and the dashboard shell. The member id comes from auth — the
// client-supplied userId is only validated against it so the shared usePresence hook keeps
// working; nobody can heartbeat someone else into invisibility of notifications (or online).
export const heartbeat = mutation({
  args: {
    roomId: v.string(),
    userId: v.string(),
    sessionId: v.string(),
    interval: v.number(),
  },
  handler: async (ctx, { roomId, userId, sessionId, interval }) => {
    const memberId = await requireActiveMember(ctx);
    if (!PRESENCE_ROOMS.includes(roomId))
      throw new ConvexError("Unknown presence room");
    if (userId !== (memberId as string))
      throw new ConvexError("Presence user mismatch");
    if (
      !Number.isFinite(interval) ||
      interval < MIN_HEARTBEAT_INTERVAL_MS ||
      interval > MAX_HEARTBEAT_INTERVAL_MS
    )
      throw new ConvexError("Invalid presence interval");
    if (sessionId.length === 0 || sessionId.length > MAX_SESSION_ID_LENGTH)
      throw new ConvexError("Invalid presence session");
    // Generic RateLimited refusal; costs one small row read + patch per heartbeat (fixed window,
    // one rateLimits row per member).
    await enforceRateLimit(ctx, "presenceHeartbeat", memberId as string);
    const { sessionToken } = await presence.heartbeat(
      ctx,
      roomId,
      memberId as string,
      sessionId,
      interval,
    );
    // Bandwidth counter (spec R.2 Q19), reviewed in Axiom: sampled, so multiply counts by
    // sample_rate. Deliberately no member or session id: a per-member heartbeat log would be a
    // presence history (spec 5.6).
    if (Math.random() < 1 / HEARTBEAT_LOG_SAMPLE_RATE) {
      logEvent({
        event: "presence.heartbeat",
        outcome: "success",
        room: roomId,
        sample_rate: HEARTBEAT_LOG_SAMPLE_RATE,
      });
    }
    // The room token is shared by every member in the room; withhold it so it can never become
    // a roster capability again (the hook then subscribes `list` with "", which returns []).
    return { roomToken: "", sessionToken };
  },
});

// The usePresence hook subscribes to this read, so it must exist, but it deliberately returns
// NOTHING. The room token is not a real capability here: every member who heartbeats a shared
// room receives the same token, so forwarding to presence.list would let any member
// see who else is (or recently was) in the room, private profiles included. Nothing in the UI
// reads the roster; the notification gate and social/getPresenceOf use presence.listUser
// server-side.
export const list = query({
  args: { roomToken: v.string() },
  handler: async (): Promise<
    { userId: string; online: boolean; lastDisconnected: number }[]
  > => [],
});

// Graceful disconnect via sendBeacon; the session token is the capability (no auth context
// available on beacons).
export const disconnect = mutation({
  args: { sessionToken: v.string() },
  handler: (ctx, { sessionToken }) => presence.disconnect(ctx, sessionToken),
});
