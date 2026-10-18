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
  // The daily cap next to imageStage's hourly one (spec 2.7: 20/h and 100/day).
  imageStageDaily: { windowMs: DAY, max: 100 },
  // Upload URLs for message photos: each staged photo needs one, plus retries of failed uploads.
  imageUploadUrl: { windowMs: HOUR, max: 40 },
  // Taps on "Show" for a blurred message photo (each hands out its URL).
  imageReveal: { windowMs: HOUR, max: 120 },
  locationSend: { windowMs: DAY, max: 20 },
  circleInvite: { windowMs: DAY, max: 30 },
  // Place searches in the location picker (each proxies one MapTiler Geocoding request).
  locationSearch: { windowMs: HOUR, max: 60 },
  // Picker map views (each pan, zoom or tap re-renders the view from MapTiler tiles).
  locationPicker: { windowMs: HOUR, max: 60 },
  // Email invitations (invitations/sendEmailInvite), follow and household together.
  emailInvite: { windowMs: DAY, max: 10 },
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

// The deployment-wide MapTiler budget: every upstream request (a tile, a Static Maps image, a
// geocoding call) is charged against an hourly and a daily cap, whoever triggered it, so no mix
// of members can run up the provider bill. Caps from env (positive integers), with defaults:
//   MAPTILER_HOURLY_CAP - default 2000 requests per fixed hour
//   MAPTILER_DAILY_CAP  - default 20000 requests per fixed day
// One row per window on the rateLimits table (keys "maptiler:global:hour" / ":day").
export const MAPTILER_HOURLY_CAP_DEFAULT = 2000;
export const MAPTILER_DAILY_CAP_DEFAULT = 20_000;

const positiveIntOr = (raw: string | undefined, fallback: number): number => {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : fallback;
};

export const mapTilerCaps = (env: Record<string, string | undefined>) => ({
  hourly: positiveIntOr(env.MAPTILER_HOURLY_CAP, MAPTILER_HOURLY_CAP_DEFAULT),
  daily: positiveIntOr(env.MAPTILER_DAILY_CAP, MAPTILER_DAILY_CAP_DEFAULT),
});

/**
 * Charge `requests` upstream MapTiler requests to the global budget. False (and nothing
 * written) when either window would go over its cap; the refusal is logged.
 */
export const chargeMapTilerBudget = async (
  ctx: MutationCtx,
  requests: number,
): Promise<boolean> => {
  if (requests <= 0) return true;
  const caps = mapTilerCaps(process.env);
  const now = Date.now();
  const windows = [
    { key: "maptiler:global:hour", windowMs: HOUR, cap: caps.hourly },
    { key: "maptiler:global:day", windowMs: DAY, cap: caps.daily },
  ];
  const planned = [];
  for (const window of windows) {
    const row = await ctx.db
      .query("rateLimits")
      .withIndex("by_key", (q) => q.eq("key", window.key))
      .unique();
    const fresh = row === null || now - row.windowStart >= window.windowMs;
    const count = (fresh ? 0 : row.count) + requests;
    if (count > window.cap) {
      logEvent({
        event: "rateLimit.refused",
        outcome: "error",
        limit: window.key,
        window_ms: window.windowMs,
        max: window.cap,
        requests,
        retry_after_ms: row ? row.windowStart + window.windowMs - now : 0,
      });
      return false;
    }
    planned.push({ window, row, fresh, count });
  }
  for (const { window, row, fresh, count } of planned) {
    if (row === null) {
      await ctx.db.insert("rateLimits", {
        key: window.key,
        windowStart: now,
        count,
      });
    } else {
      await ctx.db.patch(row._id, {
        ...(fresh && { windowStart: now }),
        count,
      });
    }
  }
  return true;
};
