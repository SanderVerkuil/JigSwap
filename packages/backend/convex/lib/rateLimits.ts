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
  // The shared upload URL (puzzles.generateUploadUrl) behind copy photos, completion photos and
  // box art (SEC-20): one per photo plus retries, hourly and daily.
  uploadUrl: { windowMs: HOUR, max: 60 },
  uploadUrlDaily: { windowMs: DAY, max: 300 },
  // Taps on "Show" for a blurred message photo (each hands out its URL).
  imageReveal: { windowMs: HOUR, max: 120 },
  locationSend: { windowMs: DAY, max: 20 },
  circleInvite: { windowMs: DAY, max: 30 },
  // Circle icons (sharing/setCircleIcon): upload URLs, and the uploads an Admin sets.
  circleIconUploadUrl: { windowMs: HOUR, max: 20 },
  circleIcon: { windowMs: HOUR, max: 10 },
  // Place searches in the location picker (each proxies one MapTiler Geocoding request).
  locationSearch: { windowMs: HOUR, max: 60 },
  // Picker map views (each pan, zoom or tap re-renders the view from MapTiler tiles).
  locationPicker: { windowMs: HOUR, max: 60 },
  // Email invitations (invitations/sendEmailInvite), follow and household together.
  emailInvite: { windowMs: DAY, max: 10 },
  // Requests to join a household (household/requestToJoinHousehold), like emailInvite.
  householdJoinRequest: { windowMs: DAY, max: 10 },
  // Presence heartbeats across all rooms and tabs: a tab sends ~4/min (app room + messages at
  // 30 s), so 30/min covers several tabs while capping heartbeat cost abuse.
  presenceHeartbeat: { windowMs: MINUTE, max: 30 },
  // Store-page imports (catalog/extractFromUrl): each runs outbound fetches and may fall through
  // to a paid Firecrawl scrape. Admins, who seed the catalogue, are exempt.
  urlImport: { windowMs: HOUR, max: 30 },
  urlImportDaily: { windowMs: DAY, max: 150 },
  // Copy and completion photos (chargePhotoAttach): one bucket for all of them, since each photo
  // runs the same paid moderation pipeline.
  photoAttach: { windowMs: HOUR, max: 40 },
  photoAttachDaily: { windowMs: DAY, max: 150 },
  // Box-art checks (catalog/boxArtUploads.chargeBoxArtCheck: an upload's sanitizeBoxArt, or a shop
  // image's importPuzzleImage), each running the paid moderation pipeline inline. Admins exempt.
  boxArtCheck: { windowMs: HOUR, max: 20 },
  boxArtCheckDaily: { windowMs: DAY, max: 60 },
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

/**
 * Charge `photos` newly attached copy or completion photos (library/addCopyPhoto,
 * solving/attachCompletionPhotos) to the acting member's photoAttach and photoAttachDaily
 * buckets, one each. Throws RateLimited like enforceRateLimit, and the throw rolls back the whole
 * mutation, so a batch is attached whole or not at all.
 */
export const chargePhotoAttach = async (
  ctx: MutationCtx,
  memberId: string,
  photos = 1,
): Promise<void> => {
  for (let i = 0; i < photos; i++) {
    await enforceRateLimit(ctx, "photoAttach", memberId);
    await enforceRateLimit(ctx, "photoAttachDaily", memberId);
  }
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

// The deployment-wide budget for Clerk invitation creations (invitations/sendEmailInvite). Clerk
// allows 100 per hour for the whole application, so we stop well below that, whoever is inviting.
//   CLERK_INVITES_HOURLY_CAP - positive integer, default 60 per fixed hour
// One row on the rateLimits table (key "clerkInvites:global:hour").
export const CLERK_INVITES_HOURLY_CAP_DEFAULT = 60;
const CLERK_INVITES_KEY = "clerkInvites:global:hour";

/**
 * Charge one Clerk invitation creation to the global hourly budget. False (and nothing written)
 * when the budget is spent; the refusal is logged as a rateLimit.refused event.
 */
export const chargeClerkInviteBudget = async (
  ctx: MutationCtx,
): Promise<boolean> => {
  const cap = positiveIntOr(
    process.env.CLERK_INVITES_HOURLY_CAP,
    CLERK_INVITES_HOURLY_CAP_DEFAULT,
  );
  const now = Date.now();
  const row = await ctx.db
    .query("rateLimits")
    .withIndex("by_key", (q) => q.eq("key", CLERK_INVITES_KEY))
    .unique();
  const fresh = row === null || now - row.windowStart >= HOUR;
  const count = (fresh ? 0 : row.count) + 1;
  if (count > cap) {
    logEvent({
      event: "rateLimit.refused",
      outcome: "error",
      limit: CLERK_INVITES_KEY,
      window_ms: HOUR,
      max: cap,
      retry_after_ms: row ? row.windowStart + HOUR - now : 0,
    });
    return false;
  }
  if (row === null) {
    await ctx.db.insert("rateLimits", {
      key: CLERK_INVITES_KEY,
      windowStart: now,
      count,
    });
  } else {
    await ctx.db.patch(row._id, { ...(fresh && { windowStart: now }), count });
  }
  return true;
};

// A fixed-window budget that is not tied to a member: a whole deployment's use of an anonymous
// form, or one invite link's landing counter. `cap` is the most the window may count. One row
// per key on the rateLimits table, reset in place when its window has passed.
export type BudgetWindow = { key: string; windowMs: number; cap: number };

/**
 * Charge `amount` to every window, or to none of them. Null when charged; otherwise the ms until
 * every full window has rolled over, with nothing written and each refusing window logged as a
 * rateLimit.refused event. The caller decides what a refusal means (throw, or skip quietly).
 */
export const chargeBudget = async (
  ctx: MutationCtx,
  windows: readonly BudgetWindow[],
  amount = 1,
): Promise<number | null> => {
  const now = Date.now();
  const planned = [];
  let retryAfterMs: number | null = null;
  for (const window of windows) {
    const row = await ctx.db
      .query("rateLimits")
      .withIndex("by_key", (q) => q.eq("key", window.key))
      .unique();
    const fresh = row === null || now - row.windowStart >= window.windowMs;
    const count = (fresh ? 0 : row.count) + amount;
    if (count > window.cap) {
      const wait = fresh
        ? window.windowMs
        : row.windowStart + window.windowMs - now;
      logEvent({
        event: "rateLimit.refused",
        outcome: "error",
        limit: window.key,
        window_ms: window.windowMs,
        max: window.cap,
        amount,
        retry_after_ms: wait,
      });
      retryAfterMs = Math.max(retryAfterMs ?? 0, wait);
      continue;
    }
    planned.push({ window, row, fresh, count });
  }
  if (retryAfterMs !== null) return retryAfterMs;
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
  return null;
};

// Deployment-wide budgets for the anonymous marketing forms: there is no member to key a limit
// on, so every visitor shares one hourly and one daily window per form (SEC-22).
export const CONTACT_BUDGET = [
  { key: "contact:global:hour", windowMs: HOUR, cap: 20 },
  { key: "contact:global:day", windowMs: DAY, cap: 100 },
] as const satisfies readonly BudgetWindow[];

export const DOC_FEEDBACK_BUDGET = [
  { key: "docFeedback:global:hour", windowMs: HOUR, cap: 60 },
  { key: "docFeedback:global:day", windowMs: DAY, cap: 300 },
] as const satisfies readonly BudgetWindow[];

// The deployment-wide Firecrawl budget: every paid scrape the URL import falls through to
// (catalog/extractFromUrl) is charged here first, whoever imports. Caps from env (positive
// integers), with defaults:
//   FIRECRAWL_HOURLY_CAP - default 20 scrapes per fixed hour
//   FIRECRAWL_DAILY_CAP  - default 100 scrapes per fixed day
export const FIRECRAWL_HOURLY_CAP_DEFAULT = 20;
export const FIRECRAWL_DAILY_CAP_DEFAULT = 100;

export const firecrawlBudget = (
  env: Record<string, string | undefined>,
): BudgetWindow[] => [
  {
    key: "firecrawl:global:hour",
    windowMs: HOUR,
    cap: positiveIntOr(env.FIRECRAWL_HOURLY_CAP, FIRECRAWL_HOURLY_CAP_DEFAULT),
  },
  {
    key: "firecrawl:global:day",
    windowMs: DAY,
    cap: positiveIntOr(env.FIRECRAWL_DAILY_CAP, FIRECRAWL_DAILY_CAP_DEFAULT),
  },
];

// One invite link's landing counter (social/recordInviteLanding, public): at most 20 counted
// landings per hour per link, so an anonymous loop cannot keep patching the link row (SEC-82).
export const inviteLandingBudget = (linkId: string): BudgetWindow[] => [
  { key: `inviteLanding:${linkId}`, windowMs: HOUR, cap: 20 },
];
