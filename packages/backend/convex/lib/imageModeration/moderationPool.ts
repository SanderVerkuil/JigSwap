import { vOnCompleteArgs, Workpool } from "@convex-dev/workpool";
import type { FunctionReference } from "convex/server";
import { v, type Infer } from "convex/values";
import { components, internal } from "../../_generated/api";
import {
  internalMutation,
  type ActionCtx,
  type MutationCtx,
} from "../../_generated/server";
import {
  MODERATION_MAX_ATTEMPTS,
  type UnscoredReason,
} from "../../library/adapters/photoModeration";
import { logEvent } from "../logEvent";

// Every photo-moderation check runs on ONE Workpool (the `moderationWorkpool` component,
// convex.config.ts): copy photos, completion photos, box art and message photos, from the upload,
// an admin "Check again" or an admin restore. The pool gives three things ctx.scheduler did not:
//
// - Bounded parallelism toward the classifier (MODERATION_POOL_PARALLELISM): an upload burst or a
//   provider outage never fans out into dozens of concurrent Sightengine calls (and jimp decodes).
// - Retries with backoff and jitter (MODERATION_RETRY): the pipeline THROWS for a retryable
//   failure that still has attempts left (moderationRetryError) and returns normally for anything
//   it decided, so a definite verdict is never retried.
// - A completion callback (onModerationComplete) that fires on the FINAL failure, including an
//   attempt that crashed mid-run (action timeout, runtime restart, deploy): the pool's recovery
//   scan finds such a job through its _scheduled_functions entry and retries or fails it. A row the
//   pipeline did not decide by then is stamped "unscored", which puts it in the admin queue.
//
// The daily sweep (stalledSweep.ts) is the backstop for anything outside the pool: a row still
// "pending" after 24 hours is stamped "unscored" with reason "stalled".

/** The moderated tables, as the pool and the sweep name them. */
export const moderationTableValidator = v.union(
  v.literal("copy"),
  v.literal("completion"),
  v.literal("boxArt"),
  v.literal("message"),
);
export type ModerationTable = Infer<typeof moderationTableValidator>;

/** The Convex table behind each moderation table name. */
export const TABLE_NAME = {
  copy: "ownedPuzzleImages",
  completion: "completionImages",
  boxArt: "boxArtUploads",
  message: "messageAttachments",
} as const;

/**
 * The pool's retry schedule: 1, 5 and 25 minutes after a failed attempt (initialBackoffMs ×
 * base^(n-1), each with ±50% jitter). The pool allows one attempt more than the pipeline uses
 * (MODERATION_MAX_ATTEMPTS + 1): the pipeline writes the verdict itself on its last counted
 * attempt, and the spare covers an attempt that crashed before it was counted.
 */
export const MODERATION_RETRY = {
  maxAttempts: MODERATION_MAX_ATTEMPTS + 1,
  initialBackoffMs: 60_000,
  base: 5,
} as const;

/**
 * At most this many checks run at once. Each one is one classifier call (Sightengine counts
 * concurrent requests against the plan) plus an in-memory decode/re-encode, and an upload burst
 * only needs to drain, not finish instantly.
 */
export const MODERATION_POOL_PARALLELISM = 4;

/** A check handed over from outside the pool (box art's inline attempt) waits this long. */
export const MODERATION_HANDOFF_DELAY_MS = 60_000;

export const moderationPool = new Workpool(components.moderationWorkpool, {
  maxParallelism: MODERATION_POOL_PARALLELISM,
  retryActionsByDefault: true,
  defaultRetryBehavior: MODERATION_RETRY,
});

// The marker a retryable failure carries through the pool to onModerationComplete. The pool hands
// the callback the error as a string (possibly wrapped, "Uncaught Error: … at …"), so the reason is
// matched, not parsed as JSON.
const RETRY_MARKER = "moderation_retryable:";

/** The error the pipeline throws (inside the pool only) so the pool retries the check. */
export const moderationRetryError = (reason: string): Error =>
  new Error(`${RETRY_MARKER}${reason}`);

const RETRYABLE_REASONS: ReadonlySet<string> = new Set<UnscoredReason>([
  "rate_limited",
  "provider_error",
  "network",
  "download_error",
  "internal_error",
]);

/**
 * The unscored reason a FINAL pool failure leaves on the row: the classifier's own reason when the
 * last attempt was a retryable failure we threw (rate_limited, network, …), otherwise
 * "check_failed" (a crash, a timeout, or anything else the pipeline did not raise itself).
 */
export const unscoredReasonOfFailure = (error: string): UnscoredReason => {
  const match = new RegExp(`${RETRY_MARKER}([a-z_]+)`).exec(error);
  const reason = match?.[1];
  return reason !== undefined && RETRYABLE_REASONS.has(reason)
    ? (reason as UnscoredReason)
    : "check_failed";
};

// Each table's action takes its own `v.id(...)`; the pool passes the id it was given back to it.
type ModerationActionRef = FunctionReference<
  "action",
  "internal",
  { imageId: string; pooled?: boolean }
>;

const moderationAction = (table: ModerationTable): ModerationActionRef =>
  moderationActionOf(table) as unknown as ModerationActionRef;

const moderationActionOf = (table: ModerationTable) => {
  switch (table) {
    case "copy":
      return internal.library.moderatePhoto.moderatePhoto;
    case "completion":
      return internal.solving.moderateCompletionPhoto.moderateCompletionPhoto;
    case "boxArt":
      return internal.catalog.moderateBoxArt.moderateBoxArt;
    case "message":
      return internal.conversation.moderateMessageImage.moderateMessageImage;
  }
};

/**
 * Enqueue a moderation check of `imageId` on the pool. Called in the same transaction as the
 * write that made the row "pending" (transactional with it), or from an action. Each enqueue is
 * one pool job with its own retries and its own onModerationComplete.
 */
export const enqueueImageModeration = async (
  ctx: MutationCtx | ActionCtx,
  table: ModerationTable,
  imageId: string,
  options: { runAfter?: number } = {},
): Promise<void> => {
  await moderationPool.enqueueAction(
    ctx,
    moderationAction(table),
    // The action validates the id against its own table (v.id).
    { imageId, pooled: true },
    {
      onComplete:
        internal.lib.imageModeration.moderationPool.onModerationComplete,
      onCompleteExcludeKinds: ["success"],
      context: { table, imageId },
      ...(options.runAfter !== undefined ? { runAfter: options.runAfter } : {}),
    },
  );
};

// The row behind a moderation id, narrowed to the fields the pool needs. Null when it is gone, or
// is not a moderated photo (a message location).
const loadModerationRow = async (
  ctx: MutationCtx,
  table: ModerationTable,
  imageId: string,
): Promise<{
  moderationStatus?: string;
  moderationAttempts?: number;
} | null> => {
  const id = ctx.db.normalizeId(TABLE_NAME[table], imageId);
  const row = id ? await ctx.db.get(id) : null;
  if (!row || !("moderationStatus" in row)) return null;
  return {
    moderationStatus: row.moderationStatus,
    moderationAttempts: row.moderationAttempts,
  };
};

/**
 * Stamp a still-"pending" row "unscored" with `reason` through its table's own setVerdict (first
 * verdict wins there too, and a message photo's send batch is advanced). A decided row is left
 * alone. Returns whether the row was stamped.
 */
export const stampUnscored = async (
  ctx: MutationCtx,
  table: ModerationTable,
  imageId: string,
  reason: UnscoredReason,
): Promise<boolean> => {
  const row = await loadModerationRow(ctx, table, imageId);
  if (!row || row.moderationStatus !== "pending") return false;
  const verdict = {
    moderationStatus: "unscored" as const,
    moderationReason: reason,
    moderationAttempts: row.moderationAttempts,
  };
  switch (table) {
    case "copy":
      await ctx.runMutation(
        internal.library.moderationStore.setModerationVerdict,
        { imageId: imageId as never, ...verdict },
      );
      break;
    case "completion":
      await ctx.runMutation(
        internal.solving.completionModerationStore.setModerationVerdict,
        { imageId: imageId as never, ...verdict },
      );
      break;
    case "boxArt":
      await ctx.runMutation(internal.catalog.boxArtModerationStore.setVerdict, {
        imageId: imageId as never,
        ...verdict,
      });
      break;
    case "message":
      await ctx.runMutation(
        internal.conversation.attachmentModerationStore.setModerationVerdict,
        { imageId: imageId as never, ...verdict },
      );
      break;
  }
  return true;
};

/**
 * Count one more attempt on a still-"pending" row and return its 1-based number, or null when the
 * row is gone or already decided. Called by the pipeline at the start of every attempt, so the
 * count survives crashes and does not depend on who ran the attempt (the pool, the inline box-art
 * check, or a retry scheduled before the pool existed).
 */
export const beginAttempt = internalMutation({
  args: { table: moderationTableValidator, imageId: v.string() },
  handler: async (ctx, { table, imageId }): Promise<number | null> => {
    const row = await loadModerationRow(ctx, table, imageId);
    if (!row || row.moderationStatus !== "pending") return null;
    const attempt = (row.moderationAttempts ?? 0) + 1;
    const id = ctx.db.normalizeId(TABLE_NAME[table], imageId);
    if (id) await ctx.db.patch(id, { moderationAttempts: attempt });
    return attempt;
  },
});

/**
 * The pool's callback for a check that ended without success: its retries ran out on a retryable
 * failure, an attempt crashed or timed out on the last try, or the job was canceled. A row still
 * "pending" is stamped "unscored" (its reason per unscoredReasonOfFailure), which puts it in the
 * admin's Unchecked photos queue; a decided row is left alone. One wide event per call.
 */
export const onModerationComplete = internalMutation({
  args: vOnCompleteArgs(
    v.object({ table: moderationTableValidator, imageId: v.string() }),
  ),
  handler: async (ctx, { workId, context, result }) => {
    if (result.kind === "success") return;
    const reason =
      result.kind === "failed"
        ? unscoredReasonOfFailure(result.error)
        : "check_failed";
    const stamped = await stampUnscored(
      ctx,
      context.table,
      context.imageId,
      reason,
    );
    logEvent({
      event: "imageModeration.checkFailed",
      outcome: "error",
      table: context.table,
      image_id: context.imageId,
      work_id: workId,
      result_kind: result.kind,
      // The error text of the last attempt, cut short (no image data is ever in it).
      error: result.kind === "failed" ? result.error.slice(0, 500) : null,
      unscored_reason: reason,
      stamped,
    });
  },
});
