import { ConvexError } from "convex/values";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { logEvent } from "./logEvent";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;

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
  locationSearch: { windowMs: HOUR, max: 30 },
  // Picker map views (each pan, zoom or tap re-renders the view from MapTiler tiles, about 4-6
  // upstream requests each).
  locationPicker: { windowMs: HOUR, max: 30 },
  // The daily caps next to them, so a handful of members can't spend the global MapTiler budget
  // (conversation/locationStore.gateLocationCall enforces both of a pair).
  locationSearchDaily: { windowMs: DAY, max: 100 },
  locationPickerDaily: { windowMs: DAY, max: 100 },
  // Email invitations (invitations/sendEmailInvite), follow and household together.
  emailInvite: { windowMs: DAY, max: 10 },
  // A new account's email invitations (younger than invitations/config NEW_ACCOUNT_AGE_MS, or
  // without a verified email), charged on top of emailInvite: a fresh sign-up can't send the
  // full allowance of JigSwap-branded email.
  emailInviteNewAccount: { windowMs: DAY, max: 3 },
  // Requests to join a household (household/requestToJoinHousehold), like emailInvite.
  householdJoinRequest: { windowMs: DAY, max: 10 },
  // My Puzzles' bulk offer calls (library/updateCopiesOffers), each rewriting up to 100 copies. One
  // action on a large shelf takes a few calls, so 30/min leaves room for several actions and Undos.
  bulkOffers: { windowMs: MINUTE, max: 30 },
  // A copy's sharing setting (library/updateCopySharing), one call per switch flipped on its page:
  // each writes the row and a domain event, and a loop must not be free (openListing keeps a quick
  // reopen from climbing Browse).
  copySharing: { windowMs: MINUTE, max: 30 },
  // Presence heartbeats across all rooms and tabs: a tab sends ~3/min (app room at 60 s +
  // messages at 30 s), so 30/min covers several tabs while capping heartbeat cost abuse.
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
  // Catalogue submissions (catalog/submitPuzzleDefinition) and filed change proposals
  // (catalog/proposeDefinitionChange): each one notifies every admin and joins the review
  // queue, and withdraw/re-file could otherwise cycle forever. Admins are exempt.
  catalogSubmit: { windowMs: HOUR, max: 10 },
  catalogSubmitDaily: { windowMs: DAY, max: 20 },
  proposalFile: { windowMs: HOUR, max: 10 },
  proposalFileDaily: { windowMs: DAY, max: 30 },
  // Follow, unfollow and cancel-request taps, all targets together (social/followMember,
  // unfollowMember, cancelFollowRequest; also the follow back on a notification).
  followToggle: { windowMs: HOUR, max: 60 },
  // Follows and follow requests from one member to one other, keyed "<follower>:<target>". Each can
  // notify the target (new_follower, follow_request_received), so a follow/unfollow or
  // request/cancel loop reaches them at most this often. Undoing (unfollow, cancel) isn't charged
  // here, so a member can always withdraw.
  followPair: { windowMs: DAY, max: 6 },
  // Notification emails to one recipient, every type together (the notifications email channel),
  // keyed by the recipient: a backstop under the per-type throttles, so no mix of senders can
  // make one inbox (and the shared sending domain) take more than this in a day.
  emailDaily: { windowMs: DAY, max: 50 },
  // Follow notices (new_follower, follow_request_received) from one actor to one recipient, per
  // out-of-band channel and type, keyed "<channel>:<type>:<recipient>:<actor>": email and push
  // announce a follow/unfollow or request/cancel loop once a day
  // (notifications/adapters/channels/followNoticeThrottle). The in-app row is not counted.
  followNotice: { windowMs: DAY, max: 1 },
  // Pushes about review work to one admin (admin_definition_submitted, admin_proposal_filed), both
  // queues together, keyed by the admin (the notifications push channel). A flood reaches their
  // device once an hour; the in-app row counts the rest (SEC-26).
  adminReviewPush: { windowMs: HOUR, max: 1 },
  // Exchange proposals (exchange/propose), all owners together: an hourly and a daily cap.
  exchangePropose: { windowMs: HOUR, max: 20 },
  exchangeProposeDaily: { windowMs: DAY, max: 50 },
  // Proposals from one member to one copy owner, keyed "<initiator>:<owner>". Each opens a thread
  // with the owner and notifies them, so a propose/cancel (or propose/decline) loop reaches one
  // owner at most this often. Charged only after the reachability gate (see exchange/propose).
  exchangePair: { windowMs: WEEK, max: 10 },
  // In-app household invites (household/inviteToHousehold), all invitees together.
  householdInvite: { windowMs: DAY, max: 20 },
  // Invites from one household to one member, keyed "<householdId>:<invitee>". A revoke deletes
  // the invite and a decline closes it, so without this an invite/revoke loop would notify the
  // invitee without end; it is also the household's re-invite cooldown after a revoke or decline.
  householdInvitePair: { windowMs: WEEK, max: 3 },
  // Push subscription registrations (notifications/pushSubscriptions), new or refreshed. The web
  // registers only when a member turns push on for a device; each new endpoint can evict an older
  // one past the per-member cap, so this also bounds that churn.
  pushSubscribe: { windowMs: HOUR, max: 10 },
  // Comments posted, all targets together: on shared photos (library/postPhotoComment) and on
  // the member's own copies (social/postPuzzleComment).
  commentPost: { windowMs: HOUR, max: 30 },
  // Puzzle reviews written or edited, all puzzles together: social/postPuzzleReview and the
  // puzzle part of solving/submitReviews (a copy-only star rating is not counted).
  reviewPost: { windowMs: HOUR, max: 20 },
  // Copies added to the member's own library (library/acquireCopy and acquireCopies), counted per
  // copy: a full quick-start batch is 25. Bounds how fast one account can flood Browse and the
  // activity feed (SEC-29); a heavy cataloguing day stays well inside it.
  copyAdd: { windowMs: DAY, max: 500 },
  // Solves logged or started (solving/recordCompletion, startCompletion and recordPastCompletions),
  // counted per solve: the quick start's past-solves batch is up to 25. Bounds how fast one account
  // can flood the activity feed's solve events (SEC-30).
  solveLog: { windowMs: DAY, max: 300 },
  // Copies shared into circles, counted per copy (sharing/shareCopiesToCircle, shareCopyToCircle): a
  // call writes a share row and an event and schedules a dispatch per copy, and a circle's page reads
  // only its newest shares. Circles created alongside it (sharing/createCircle).
  circleShare: { windowMs: DAY, max: 1000 },
  circleCreate: { windowMs: DAY, max: 10 },
  // Profile visibility changes (social/setProfileVisibility), Undo included: each one re-stamps every
  // copy and re-counts every definition with an open one (library/ownerListingVisibility).
  profileVisibility: { windowMs: HOUR, max: 10 },
  // Collections and personal categories created (library/createCollection, createPersonalCategory).
  // Their text is bounded, but not how many a member has, and a profile's collections are read whole.
  collectionCreate: { windowMs: DAY, max: 30 },
  categoryCreate: { windowMs: DAY, max: 30 },
} as const satisfies Record<string, { windowMs: number; max: number }>;

export type RateLimitName = keyof typeof RATE_LIMITS;

type WindowCharge =
  { allowed: true } | { allowed: false; retryAfterMs: number };

/**
 * The members a composite subject names ("<actor>:<target>", ...). Every limit keyed by a pair
 * passes them, so that deleting either member's account also deletes the counter
 * (conversation/purgeMemberMessagingData finds it by these, not by its key).
 */
export type PairMembers = {
  readonly pairActorId?: Id<"users">;
  readonly pairTargetId: Id<"users">;
};

// Count `amount` actions (default one) against `name` for `subject` in its current fixed window.
// When they don't all fit, nothing is written, so refused attempts don't extend the lockout.
const chargeWindow = async (
  ctx: MutationCtx,
  name: RateLimitName,
  subject: string,
  pair?: PairMembers,
  amount = 1,
): Promise<WindowCharge> => {
  const { windowMs, max } = RATE_LIMITS[name];
  const key = `${name}:${subject}`;
  const now = Date.now();
  const row = await ctx.db
    .query("rateLimits")
    .withIndex("by_key", (q) => q.eq("key", key))
    .unique();
  const fresh = row === null || now - row.windowStart >= windowMs;
  const count = (fresh ? 0 : row.count) + amount;

  if (count > max) {
    return {
      allowed: false,
      retryAfterMs: fresh ? windowMs : row.windowStart + windowMs - now,
    };
  }
  if (row === null) {
    await ctx.db.insert("rateLimits", {
      key,
      windowStart: now,
      count,
      ...pair,
    });
  } else {
    await ctx.db.patch(row._id, {
      ...(fresh && { windowStart: now }),
      count,
    });
  }
  return { allowed: true };
};

const logRefusal = (
  name: RateLimitName,
  retryAfterMs: number,
  fields: Record<string, string>,
): void => {
  const { windowMs, max } = RATE_LIMITS[name];
  logEvent({
    event: "rateLimit.refused",
    outcome: "error",
    limit: name,
    ...fields,
    window_ms: windowMs,
    max,
    retry_after_ms: retryAfterMs,
  });
};

// Count `amount` actions (default one) against the member's `name` limit, or throw
// ConvexError({ code: "RateLimited", retryAfterMs }) when they don't all fit in the current
// window. A refusal writes nothing (the throw rolls the mutation back), so refused attempts don't
// extend the lockout. Call it before the action's own writes.
export const enforceRateLimit = async (
  ctx: MutationCtx,
  name: RateLimitName,
  memberId: string,
  pair?: PairMembers,
  amount = 1,
): Promise<void> => {
  const charge = await chargeWindow(ctx, name, memberId, pair, amount);
  if (charge.allowed) return;
  logRefusal(name, charge.retryAfterMs, { member_id: memberId });
  throw new ConvexError({
    code: "RateLimited",
    retryAfterMs: charge.retryAfterMs,
  });
};

/**
 * Count one occurrence against `name` for `subject` (a member id, or a composite key) without
 * throwing: true when it fits the current window (and is counted), false when the window is full
 * (nothing written; the refusal is logged). For work the caller skips rather than refuses, such
 * as an out-of-band notification, where a throw would roll back the rest of the mutation.
 */
export const consumeRateLimit = async (
  ctx: MutationCtx,
  name: RateLimitName,
  subject: string,
  pair?: PairMembers,
): Promise<boolean> => {
  const charge = await chargeWindow(ctx, name, subject, pair);
  if (!charge.allowed) {
    logRefusal(name, charge.retryAfterMs, { subject });
  }
  return charge.allowed;
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
// MAPTILER_RENDER_RESERVE_PERCENT of each window is kept for the final render of a sent location
// (conversation/locationStore.chargeRender): picker views and searches stop short of it.
export const MAPTILER_HOURLY_CAP_DEFAULT = 2000;
export const MAPTILER_DAILY_CAP_DEFAULT = 20_000;
export const MAPTILER_RENDER_RESERVE_PERCENT = 20;

const positiveIntOr = (raw: string | undefined, fallback: number): number => {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : fallback;
};

export const mapTilerCaps = (env: Record<string, string | undefined>) => ({
  hourly: positiveIntOr(env.MAPTILER_HOURLY_CAP, MAPTILER_HOURLY_CAP_DEFAULT),
  daily: positiveIntOr(env.MAPTILER_DAILY_CAP, MAPTILER_DAILY_CAP_DEFAULT),
});

// The part of a window's cap that picker views and searches may use.
const withoutRenderReserve = (cap: number): number =>
  Math.floor((cap * (100 - MAPTILER_RENDER_RESERVE_PERCENT)) / 100);

/**
 * Charge `requests` upstream MapTiler requests to the global budget. False (and nothing
 * written) when either window would go over its cap; the refusal is logged. With
 * `reserveForRenders` (picker views and searches) each window counts as full once it reaches
 * its cap less the render reserve, so final renders can still be charged after the picker has
 * spent its share.
 */
export const chargeMapTilerBudget = async (
  ctx: MutationCtx,
  requests: number,
  { reserveForRenders = false }: { reserveForRenders?: boolean } = {},
): Promise<boolean> => {
  if (requests <= 0) return true;
  const caps = mapTilerCaps(process.env);
  const capOf = (cap: number) =>
    reserveForRenders ? withoutRenderReserve(cap) : cap;
  const now = Date.now();
  const windows = [
    { key: "maptiler:global:hour", windowMs: HOUR, cap: capOf(caps.hourly) },
    { key: "maptiler:global:day", windowMs: DAY, cap: capOf(caps.daily) },
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

// The deployment-wide budget for email invitations (invitations/emailInviteStore
// .beginEmailInvite). Clerk allows 100 invitation creations per hour for the whole application, so
// we stop well below that, whoever is inviting. Every accepted invitation is charged, whatever the
// address turns out to be (each creates at most one Clerk invitation), so whether the budget is
// spent never depends on earlier invitees' addresses. Charged with chargeBudget.
//   CLERK_INVITES_HOURLY_CAP - positive integer, default 60 per fixed hour
// One row on the rateLimits table (key "clerkInvites:global:hour").
export const CLERK_INVITES_HOURLY_CAP_DEFAULT = 60;

export const clerkInviteBudget = (
  env: Record<string, string | undefined>,
): BudgetWindow[] => [
  {
    key: "clerkInvites:global:hour",
    windowMs: HOUR,
    cap: positiveIntOr(
      env.CLERK_INVITES_HOURLY_CAP,
      CLERK_INVITES_HOURLY_CAP_DEFAULT,
    ),
  },
];

// A fixed-window budget that is not tied to a member: a whole deployment's use of an anonymous
// form, or one invite link's landing counter. `cap` is the most the window may count. One row
// per key on the rateLimits table, reset in place when its window has passed.
export type BudgetWindow = { key: string; windowMs: number; cap: number };

/**
 * Charge `amount` to every window, or to none of them. Null when charged; otherwise the ms until
 * every full window has rolled over, with nothing written. The caller decides what a refusal
 * means (throw, or skip quietly).
 *
 * Logging: the charge that fills a window logs one info-level rateLimit.filled event, so each
 * window reports at most once that it ran out. Each refusal is also logged as an error-level
 * rateLimit.refused event unless `logRefusals` is false; anonymous callers pass false, since
 * their refusals are as frequent as a caller cares to loop and would otherwise drive unbounded
 * error-level log volume and alerts.
 */
export const chargeBudget = async (
  ctx: MutationCtx,
  windows: readonly BudgetWindow[],
  amount = 1,
  { logRefusals = true }: { logRefusals?: boolean } = {},
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
      if (logRefusals) {
        logEvent({
          event: "rateLimit.refused",
          outcome: "error",
          limit: window.key,
          window_ms: window.windowMs,
          max: window.cap,
          amount,
          retry_after_ms: wait,
        });
      }
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
    // A charged window never passes its cap, and refusals write nothing, so this is once per window.
    if (count === window.cap) {
      logEvent({
        event: "rateLimit.filled",
        outcome: "success",
        limit: window.key,
        window_ms: window.windowMs,
        max: window.cap,
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
