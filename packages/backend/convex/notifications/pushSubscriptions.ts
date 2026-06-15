import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import {
  internalMutation,
  internalQuery,
  mutation,
} from "../_generated/server";
import { requireMember } from "../identity/requireMember";

// Web Push subscription storage. The client (service worker) subscribes via the PushManager and
// registers the resulting endpoint+keys here; the push channel (sendWebPush) fans notifications out
// to every active subscription of the recipient. Subscriptions are owned by the authed member, never
// trusted from the client beyond the subscription payload itself.

// Upsert the caller's subscription, keyed by its unique push-service `endpoint`. Re-registering the
// same endpoint (e.g. after a key rotation or a re-subscribe) refreshes the keys in place rather
// than duplicating. Re-assigns ownership if the same endpoint was previously another user's (shared
// device). Returns nothing — the client only needs the call to succeed.
export const registerPushSubscription = mutation({
  args: {
    endpoint: v.string(),
    p256dh: v.string(),
    auth: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = (await requireMember(ctx)) as unknown as Id<"users">;
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
      return;
    }
    await ctx.db.insert("pushSubscriptions", {
      userId,
      endpoint: args.endpoint,
      p256dh: args.p256dh,
      auth: args.auth,
      createdAt: Date.now(),
    });
  },
});

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
