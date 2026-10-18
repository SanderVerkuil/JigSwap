import { ConvexError } from "convex/values";
import type { MutationCtx } from "../_generated/server";
import { logEvent } from "./logEvent";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

// Per-member action limits (spec 2.7). Starting defaults; each is a fixed window of `windowMs`
// allowing at most `max` actions.
export const RATE_LIMITS = {
  messagePost: { windowMs: MINUTE, max: 30 },
  blockToggle: { windowMs: DAY, max: 30 },
  reportFile: { windowMs: DAY, max: 10 },
  imageStage: { windowMs: HOUR, max: 20 },
  // Upload URLs for message photos: each staged photo needs one, plus retries of failed uploads.
  imageUploadUrl: { windowMs: HOUR, max: 40 },
  // Taps on "Show" for a blurred message photo (each hands out its URL).
  imageReveal: { windowMs: HOUR, max: 120 },
  locationSend: { windowMs: DAY, max: 20 },
  circleInvite: { windowMs: DAY, max: 30 },
} as const satisfies Record<string, { windowMs: number; max: number }>;

export type RateLimitName = keyof typeof RATE_LIMITS;

// Count one action against the member's `name` limit, or throw
// ConvexError({ code: "RateLimited", retryAfterMs }) when the current window is full. A refusal
// writes nothing (the throw rolls the mutation back), so refused attempts don't extend the
// lockout. Call it before the action's own writes.
export const enforceRateLimit = async (
  ctx: MutationCtx,
  name: RateLimitName,
  memberId: string,
): Promise<void> => {
  const { windowMs, max } = RATE_LIMITS[name];
  const key = `${name}:${memberId}`;
  const now = Date.now();
  const row = await ctx.db
    .query("rateLimits")
    .withIndex("by_key", (q) => q.eq("key", key))
    .unique();

  if (row === null) {
    await ctx.db.insert("rateLimits", { key, windowStart: now, count: 1 });
    return;
  }
  if (now - row.windowStart >= windowMs) {
    await ctx.db.patch(row._id, { windowStart: now, count: 1 });
    return;
  }
  if (row.count < max) {
    await ctx.db.patch(row._id, { count: row.count + 1 });
    return;
  }

  const retryAfterMs = row.windowStart + windowMs - now;
  logEvent({
    event: "rateLimit.refused",
    outcome: "error",
    limit: name,
    member_id: memberId,
    window_ms: windowMs,
    max,
    retry_after_ms: retryAfterMs,
  });
  throw new ConvexError({ code: "RateLimited", retryAfterMs });
};
