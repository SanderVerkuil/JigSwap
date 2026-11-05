import type { PushDeviceService, PushDeviceView } from "@jigswap/contracts";
import { ConvexError, v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
  type MutationCtx,
} from "../_generated/server";
import { requireMember } from "../identity/requireMember";
import { logEvent } from "../lib/logEvent";
import { enforceRateLimit } from "../lib/rateLimits";
import {
  isAllowedPushEndpoint,
  isValidPushKeys,
  MAX_PUSH_SUBSCRIPTIONS_PER_MEMBER,
  pushEndpointHost,
} from "./adapters/webPush";

// Web Push subscription storage. The client (service worker) subscribes via the PushManager and
// registers the resulting endpoint+keys here; the push channel (sendWebPush) fans notifications out
// to every active subscription of the recipient. Subscriptions are owned by the authed member, never
// trusted from the client beyond the subscription payload itself.

// Upsert the caller's subscription, keyed by its unique push-service `endpoint`. Re-registering the
// same endpoint (e.g. after a key rotation or a re-subscribe) refreshes the keys in place rather
// than duplicating. Re-assigns ownership if the same endpoint was previously another user's (shared
// device). Returns nothing — the client only needs the call to succeed.
//
// The push action POSTs to whatever is stored here, so only a browser push service endpoint with
// keys it can encrypt to is accepted (adapters/webPush isAllowedPushEndpoint, isValidPushKeys),
// else ConvexError InvalidPushSubscription. Registrations are rate limited (pushSubscribe), and a
// member keeps at most MAX_PUSH_SUBSCRIPTIONS_PER_MEMBER: one more evicts their oldest.
export const registerPushSubscription = mutation({
  args: {
    endpoint: v.string(),
    p256dh: v.string(),
    auth: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = (await requireMember(ctx)) as unknown as Id<"users">;
    await enforceRateLimit(ctx, "pushSubscribe", userId);
    const invalid = !isAllowedPushEndpoint(args.endpoint)
      ? "endpoint"
      : !isValidPushKeys(args)
        ? "keys"
        : null;
    if (invalid !== null) {
      // The host only: the path carries the device's push token.
      logEvent({
        event: "notifications.registerPushSubscription",
        outcome: "error",
        reason: `invalid_${invalid}`,
        user_id: userId,
        endpoint_host: pushEndpointHost(args.endpoint),
      });
      throw new ConvexError({
        code: "InvalidPushSubscription",
        message: "This browser's push service isn't supported.",
      });
    }

    const existing = await ctx.db
      .query("pushSubscriptions")
      .withIndex("by_endpoint", (q) => q.eq("endpoint", args.endpoint))
      .unique();
    if (existing) {
      await ctx.db.patch(existing._id, {
        userId,
        p256dh: args.p256dh,
        auth: args.auth,
      });
      await evictBeyondCap(ctx, userId, existing._id);
      return;
    }
    const id = await ctx.db.insert("pushSubscriptions", {
      userId,
      endpoint: args.endpoint,
      p256dh: args.p256dh,
      auth: args.auth,
      createdAt: Date.now(),
    });
    await evictBeyondCap(ctx, userId, id);
  },
});

// Keep the member's newest MAX_PUSH_SUBSCRIPTIONS_PER_MEMBER subscriptions (by createdAt), always
// including `keep`, the one just registered, and delete the rest.
const evictBeyondCap = async (
  ctx: MutationCtx,
  userId: Id<"users">,
  keep: Id<"pushSubscriptions">,
): Promise<void> => {
  const others = (
    await ctx.db
      .query("pushSubscriptions")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect()
  )
    .filter((row) => row._id !== keep)
    .sort((a, b) => b.createdAt - a.createdAt);
  for (const stale of others.slice(MAX_PUSH_SUBSCRIPTIONS_PER_MEMBER - 1)) {
    await ctx.db.delete(stale._id);
  }
};

// Remove the caller's subscription for an endpoint (e.g. the member disabled push or the browser
// unsubscribed). Scoped to the caller so one member can't delete another's subscription. No-op when
// the endpoint isn't theirs / doesn't exist.
export const unregisterPushSubscription = mutation({
  args: { endpoint: v.string() },
  handler: async (ctx, args) => {
    const userId = (await requireMember(ctx)) as unknown as Id<"users">;
    const existing = await ctx.db
      .query("pushSubscriptions")
      .withIndex("by_endpoint", (q) => q.eq("endpoint", args.endpoint))
      .unique();
    if (existing && existing.userId === userId) {
      await ctx.db.delete(existing._id);
    }
  },
});

// The push service behind an endpoint, by host. Only this coarse label leaves the server: the
// endpoint itself identifies the browser to its push service.
const PUSH_SERVICE_HOSTS: readonly (readonly [string, PushDeviceService])[] = [
  ["fcm.googleapis.com", "chrome"],
  ["push.services.mozilla.com", "firefox"],
  ["push.apple.com", "safari"],
  ["notify.windows.com", "edge"],
];

const pushServiceOf = (endpoint: string): PushDeviceService => {
  let host: string;
  try {
    host = new URL(endpoint).hostname;
  } catch {
    return "other";
  }
  const match = PUSH_SERVICE_HOSTS.find(
    ([suffix]) => host === suffix || host.endsWith(`.${suffix}`),
  );
  return match ? match[1] : "other";
};

// A member has a handful of devices; the cap only bounds the read.
const MAX_LISTED_DEVICES = 50;

// The caller's own push devices, newest first (SEC-54), so they can see where push still arrives
// and revoke a browser they no longer use. `currentEndpoint` is the asking browser's own endpoint,
// used only to flag its row as `current`; endpoints and keys never appear in the result.
export const listMyPushDevices = query({
  args: { currentEndpoint: v.optional(v.string()) },
  handler: async (ctx, args): Promise<PushDeviceView[]> => {
    const userId = (await requireMember(ctx)) as unknown as Id<"users">;
    const rows = await ctx.db
      .query("pushSubscriptions")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .order("desc")
      .take(MAX_LISTED_DEVICES);
    return rows
      .map((row) => ({
        id: row._id,
        service: pushServiceOf(row.endpoint),
        createdAt: row.createdAt,
        current: row.endpoint === args.currentEndpoint,
      }))
      .sort((a, b) => b.createdAt - a.createdAt);
  },
});

// Remove one of the caller's push devices by its listed id (SEC-54): that browser gets no more
// pushes, even though it still holds its own subscription until it next opens JigSwap signed out.
// Another member's id, or a malformed one, is a silent no-op.
export const revokePushDevice = mutation({
  args: { id: v.string() },
  handler: async (ctx, args) => {
    const userId = (await requireMember(ctx)) as unknown as Id<"users">;
    const id = ctx.db.normalizeId("pushSubscriptions", args.id);
    if (!id) return;
    const row = await ctx.db.get(id);
    if (row && row.userId === userId) {
      await ctx.db.delete(id);
    }
  },
});

// Internal: every active subscription for a recipient, read by the sendWebPush action.
export const listSubscriptionsForUser = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, args) =>
    ctx.db
      .query("pushSubscriptions")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .collect(),
});

// Internal: delete a subscription the push service reported as permanently gone (404/410).
export const pruneSubscription = internalMutation({
  args: { id: v.id("pushSubscriptions") },
  handler: async (ctx, args) => {
    await ctx.db.delete(args.id);
  },
});
