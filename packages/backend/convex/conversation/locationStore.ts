import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { internalMutation, internalQuery } from "../_generated/server";
import { requireMember } from "../identity/requireMember";
import { enforceRateLimit } from "../lib/rateLimits";
import { assertThreadNotBlocked } from "../social/blocks";
import { participantThreadOf } from "./messageAttachments";
import { assertLocationAvailable, settleLocation } from "./sharedLocations";

// The database side of the location actions (searchPlaces, renderPickerMap, renderLocationMap):
// actions can't read or write the database themselves.

/**
 * The gate every picker action passes before calling MapTiler, as the calling member (the
 * action's auth carries over): location sharing configured, a participant of the thread, the pair
 * not blocked, and within the action's own rate limit. Returns the member's preferred language
 * for the place search.
 */
export const gateLocationCall = internalMutation({
  args: {
    threadId: v.string(),
    limit: v.union(v.literal("locationSearch"), v.literal("locationPicker")),
  },
  handler: async (ctx, { threadId, limit }) => {
    const me = (await requireMember(ctx)) as unknown as Id<"users">;
    assertLocationAvailable();
    await participantThreadOf(ctx, threadId, me);
    await assertThreadNotBlocked(ctx, threadId, me);
    await enforceRateLimit(ctx, limit, me);
    const user = await ctx.db.get(me);
    return { preferredLanguage: user?.preferredLanguage };
  },
});

/** What the final render needs: a location still waiting for its map (null otherwise). */
export const getLocationForRender = internalQuery({
  args: { attachmentId: v.id("messageAttachments") },
  handler: async (ctx, { attachmentId }) => {
    const row = await ctx.db.get(attachmentId);
    if (row?.kind !== "location" || row.messageId !== undefined) return null;
    return { lat: row.lat, lng: row.lng, precision: row.precision };
  },
});

/** The final render settled: record it and append the location message (sharedLocations). */
export const settleLocationMap = internalMutation({
  args: {
    attachmentId: v.id("messageAttachments"),
    mapFileId: v.optional(v.id("_storage")),
  },
  handler: async (ctx, { attachmentId, mapFileId }) =>
    settleLocation(ctx, attachmentId, mapFileId),
});

/** A picker view's temporary image expired (PICKER_MAP_TTL_MS after it was rendered). */
export const deletePickerMap = internalMutation({
  args: { fileId: v.id("_storage") },
  handler: async (ctx, { fileId }) => {
    if (await ctx.db.system.get(fileId)) await ctx.storage.delete(fileId);
  },
});
