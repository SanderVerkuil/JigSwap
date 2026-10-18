import {
  MAX_CAPTION_LENGTH,
  resolveLocationPrecision,
  SharedLocation,
} from "@jigswap/domain";
import { ConvexError, v } from "convex/values";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { mutation } from "../_generated/server";
import { requireMember } from "../identity/requireMember";
import { enforceRateLimit } from "../lib/rateLimits";
import { assertThreadNotBlocked } from "../social/blocks";
import { participantThreadOf } from "./messageAttachments";
import {
  assertLocationAvailable,
  isMutualWithOthers,
  LOCATION_RENDER_TIMEOUT_MS,
} from "./sharedLocations";

const precisionValidator = v.union(
  v.literal("exact"),
  v.literal("approximate"),
);

// Share a place in a thread, once (spec 2.4, R.5, R.6). Gates: location sharing configured
// (LocationUnavailable), a participant, the pair not blocked either way, the message and the
// daily location limits. The precision is decided here, never by the client: a placed or
// searched pin (`source: "pin"`) is exact; the member's current location (`source: "gps"`) is
// snapped to the ~1 km grid unless they chose exact AND every other participant is a mutual
// follower. SharedLocation rounds the coordinates by that precision, so only the shared
// coordinates are ever stored. The row starts "pending" and the map render is scheduled; the
// message is appended once the render settles (sharedLocations.settleLocation).
export const sendLocation = mutation({
  args: {
    threadId: v.string(),
    lat: v.number(),
    lng: v.number(),
    source: v.union(v.literal("pin"), v.literal("gps")),
    precision: precisionValidator,
    label: v.optional(v.string()),
    caption: v.optional(v.string()),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{ attachmentId: Id<"messageAttachments"> }> => {
    const me = (await requireMember(ctx)) as unknown as Id<"users">;
    assertLocationAvailable();
    const thread = await participantThreadOf(ctx, args.threadId, me);
    await assertThreadNotBlocked(ctx, args.threadId, me);
    await enforceRateLimit(ctx, "messagePost", me);
    await enforceRateLimit(ctx, "locationSend", me);

    const caption = args.caption?.trim() || undefined;
    if (caption !== undefined && caption.length > MAX_CAPTION_LENGTH) {
      throw new ConvexError({
        code: "CaptionTooLong",
        message: `A caption must be at most ${MAX_CAPTION_LENGTH} characters`,
      });
    }
    const precision = resolveLocationPrecision({
      source: args.source,
      requested: args.precision,
      mutualFollowers:
        args.source === "gps" &&
        args.precision === "exact" &&
        (await isMutualWithOthers(ctx, thread.participants, me)),
    });
    const shared = SharedLocation.create({
      lat: args.lat,
      lng: args.lng,
      precision,
      label: args.label,
    });
    if (shared.isErr) {
      throw new ConvexError({
        code: shared.error.code,
        message: shared.error.message,
      });
    }
    const location = shared.value;
    const now = Date.now();
    const attachmentId = await ctx.db.insert("messageAttachments", {
      kind: "location",
      threadAggregateId: args.threadId,
      uploaderId: me,
      lat: location.lat,
      lng: location.lng,
      precision: location.precision,
      ...(location.label !== undefined && { label: location.label }),
      mapStatus: "pending",
      ...(caption !== undefined && { caption }),
      createdAt: now,
      updatedAt: now,
    });
    await ctx.scheduler.runAfter(
      0,
      internal.conversation.renderLocationMap.renderLocationMap,
      { attachmentId },
    );
    await ctx.scheduler.runAfter(
      LOCATION_RENDER_TIMEOUT_MS,
      internal.conversation.locationStore.expireLocationRender,
      { attachmentId },
    );
    return { attachmentId };
  },
});
