import { vOnCompleteArgs, Workpool } from "@convex-dev/workpool";
import type { FunctionReference } from "convex/server";
import { v } from "convex/values";
import { components, internal } from "../../_generated/api";
import {
  internalMutation,
  internalQuery,
  type MutationCtx,
  type QueryCtx,
} from "../../_generated/server";
import { logEvent } from "../logEvent";
import {
  moderationTableValidator,
  TABLE_NAME,
  type ModerationTable,
} from "./moderationPool";

// The CSAM hash RE-check of a photo whose hash check was "unavailable" (the hash service could not
// answer): the pipeline stored the MD5 + SHA-1 of the original and the re-encode on the row
// (`pendingHashes`) and keeps the photo unpublished (hashCheckFields: no URL before the check has
// passed). Those STORED hashes are checked again on HASH_RECHECK_DELAYS_MS, each re-check one job
// on its own Workpool (the `hashRecheckWorkpool` component, convex.config.ts), until the service
// answers: no_match publishes, a match quarantines and escalates (pipeline.runHashRecheck).
//
// TIMEOUT: once a photo has waited HASH_CHECK_TIMEOUT_MS on its hash check, the next arm stops the
// chain instead: the row is stamped `hashCheckTimedOutAt`, stays unpublished, and goes to the admin
// queue (admin/listUncheckedPhotos), where an admin approves or rejects it by hand
// (admin/decideUncheckedPhoto). Nothing re-checks it after that. Should a re-check still run (a
// job lost and found again), its answer counts: a match quarantines and escalates even over an
// admin approval, a no_match publishes an undecided photo.
//
// Why a pool of its own, not the moderation pool: the re-checks talk to the hash service, whose
// limits are not the classifier's; after a hash-service outage every waiting photo's re-check
// comes due together, and that backlog must not hold the 4 classifier slots uploads need (nor a
// classifier backlog delay the re-checks). It also gets its own short retry policy.
//
// EXACTLY ONE current re-check per row: the row holds the current attempt (`hashRecheckAttempt`)
// and when it is due (`hashRecheckDueAt`). Every enqueue goes through armHashRecheck, a
// compare-and-set on that attempt in the same transaction as the enqueue, so two runs of the same
// attempt (a pool retry racing a late success, the sweep racing the pipeline) arm at most one
// successor, and a job whose attempt is no longer the row's does nothing (isCurrentHashRecheck).
//
// Never stuck: an attempt that throws or crashes (timeout, restart, deploy) is retried by the pool
// (HASH_RECHECK_RETRY); when the pool gives up, onHashRecheckComplete arms the next attempt on the
// usual schedule, exactly as if the service had answered "unavailable". The daily sweep
// (sweepLostHashRechecks) re-arms a waiting row whose re-check was lost outside the pool (a chain
// scheduled before the pool existed, or a pipeline attempt that crashed between storing the hashes
// and arming the first re-check).

/**
 * Backoff for re-checking the STORED hashes of a photo whose hash check was "unavailable": 15
 * minutes after the upload, doubling up to 24 hours, then every 24 hours for as long as the row
 * is still waiting. Meanwhile the photo stays unpublished (no hashCheckedAt => no URL).
 */
export const HASH_RECHECK_DELAYS_MS: readonly number[] = [
  15 * 60_000,
  30 * 60_000,
  60 * 60_000,
  2 * 60 * 60_000,
  4 * 60 * 60_000,
  8 * 60 * 60_000,
  16 * 60 * 60_000,
  24 * 60 * 60_000,
];

/** The delay before re-check `attempt` (1-based). */
export const hashRecheckDelayMs = (attempt: number): number =>
  HASH_RECHECK_DELAYS_MS[attempt - 1] ??
  HASH_RECHECK_DELAYS_MS[HASH_RECHECK_DELAYS_MS.length - 1];

/**
 * The pool's retries of ONE re-check that threw or crashed: about 1 and 5 minutes later (±50%
 * jitter). "unavailable" is not a failure (the job arms the next attempt and succeeds); only an
 * error of ours or a crash is retried here.
 */
export const HASH_RECHECK_RETRY = {
  maxAttempts: 3,
  initialBackoffMs: 60_000,
  base: 5,
} as const;

/**
 * At most this many re-checks run at once. Each is up to two hash-service requests (original and
 * re-encode); nothing waits on them interactively (the photo has waited 15 minutes at least), so
 * the backlog drains gently rather than burst at a service that just came back.
 */
export const HASH_RECHECK_POOL_PARALLELISM = 2;

/**
 * How long a photo waits on its hash check before the re-checks stop and an admin decides it:
 * counted from `hashCheckPendingSince` (the upload), checked whenever the next re-check would be
 * armed. With HASH_RECHECK_DELAYS_MS the last re-check runs a little over 7 days in.
 */
export const HASH_CHECK_TIMEOUT_MS = 7 * 24 * 60 * 60 * 1000;

/** A waiting row whose current re-check was due this long ago and never re-armed is lost. */
export const HASH_RECHECK_LOST_AFTER_MS = 24 * 60 * 60 * 1000;

/** Rows read per sweep run. */
export const HASH_RECHECK_SWEEP_PAGE = 100;

export const hashRecheckPool = new Workpool(components.hashRecheckWorkpool, {
  maxParallelism: HASH_RECHECK_POOL_PARALLELISM,
  retryActionsByDefault: true,
  defaultRetryBehavior: HASH_RECHECK_RETRY,
});

// Each table's re-check action takes its own `v.id(...)`; the pool passes the id back to it.
type HashRecheckActionRef = FunctionReference<
  "action",
  "internal",
  { imageId: string; attempt?: number; pooled?: boolean }
>;

const hashRecheckAction = (table: ModerationTable): HashRecheckActionRef =>
  hashRecheckActionOf(table) as unknown as HashRecheckActionRef;

const hashRecheckActionOf = (table: ModerationTable) => {
  switch (table) {
    case "copy":
      return internal.library.moderatePhoto.recheckHashes;
    case "completion":
      return internal.solving.moderateCompletionPhoto.recheckHashes;
    case "boxArt":
      return internal.catalog.moderateBoxArt.recheckHashes;
    case "message":
      return internal.conversation.moderateMessageImage.recheckHashes;
  }
};

type RecheckState = {
  /** Still waiting on its hash check: stored hashes, no pass, not quarantined, not timed out. */
  waiting: boolean;
  attempt?: number;
  dueAt?: number;
  pendingSince?: number;
};

const recheckStateOf = (row: {
  pendingHashes?: unknown;
  hashCheckedAt?: number;
  moderationStatus?: string;
  hashRecheckAttempt?: number;
  hashRecheckDueAt?: number;
  hashCheckPendingSince?: number;
  hashCheckTimedOutAt?: number;
}): RecheckState => ({
  waiting:
    row.pendingHashes !== undefined &&
    row.hashCheckedAt === undefined &&
    row.moderationStatus !== "quarantined" &&
    row.hashCheckTimedOutAt === undefined,
  attempt: row.hashRecheckAttempt,
  dueAt: row.hashRecheckDueAt,
  pendingSince: row.hashCheckPendingSince,
});

// The re-check bookkeeping of a row; null when it is gone or is not a photo (a message location).
const loadRecheckState = async (
  ctx: QueryCtx,
  table: ModerationTable,
  imageId: string,
): Promise<RecheckState | null> => {
  const id = ctx.db.normalizeId(TABLE_NAME[table], imageId);
  const row = id ? await ctx.db.get(id) : null;
  if (!row || !("pendingHashes" in row) || !("moderationStatus" in row)) {
    return null;
  }
  return recheckStateOf(row);
};

/**
 * Arm re-check `next` of a waiting row, `runAfter` ms from now, but only while the row's current
 * attempt is still `expected` (null: none armed yet). Records the attempt and its due time on the
 * row and enqueues the job in the same transaction. Returns whether it armed. A row that has
 * waited HASH_CHECK_TIMEOUT_MS is timed out instead (stamped, nothing armed; one wide event).
 */
export const armHashRecheck = async (
  ctx: MutationCtx,
  table: ModerationTable,
  imageId: string,
  {
    expected,
    next,
    runAfter,
  }: {
    expected: number | null;
    next: number;
    runAfter: number;
  },
): Promise<boolean> => {
  const state = await loadRecheckState(ctx, table, imageId);
  if (!state?.waiting || (state.attempt ?? null) !== expected) return false;
  const id = ctx.db.normalizeId(TABLE_NAME[table], imageId);
  if (!id) return false;
  const now = Date.now();
  if (
    state.pendingSince !== undefined &&
    now - state.pendingSince >= HASH_CHECK_TIMEOUT_MS
  ) {
    await ctx.db.patch(id, {
      hashCheckTimedOutAt: now,
      hashRecheckDueAt: undefined,
    });
    // Error level: a photo now needs an admin (Admin → Moderation → Unchecked photos).
    logEvent({
      event: "imageModeration.hashCheckTimedOut",
      outcome: "error",
      table,
      image_id: imageId,
      attempt: state.attempt ?? null,
      waited_ms: now - state.pendingSince,
    });
    return false;
  }
  await ctx.db.patch(id, {
    hashRecheckAttempt: next,
    hashRecheckDueAt: now + runAfter,
  });
  await hashRecheckPool.enqueueAction(
    ctx,
    hashRecheckAction(table),
    // The action validates the id against its own table (v.id).
    { imageId, attempt: next, pooled: true },
    {
      onComplete:
        internal.lib.imageModeration.hashRecheckPool.onHashRecheckComplete,
      onCompleteExcludeKinds: ["success"],
      context: { table, imageId, attempt: next },
      runAfter,
    },
  );
  return true;
};

/**
 * The pipeline found the hash service unavailable and stored the hashes: arm the first re-check
 * (HASH_RECHECK_DELAYS_MS[0] from now), unless one is armed already.
 */
export const startHashRecheck = internalMutation({
  args: { table: moderationTableValidator, imageId: v.string() },
  handler: (ctx, { table, imageId }): Promise<boolean> =>
    armHashRecheck(ctx, table, imageId, {
      expected: null,
      next: 1,
      runAfter: hashRecheckDelayMs(1),
    }),
});

/**
 * Re-check `attempt` found the service still unavailable: arm the next one on the schedule.
 * `legacy`: the re-check was scheduled before the pool existed (the row has no attempt yet).
 */
export const continueHashRecheck = internalMutation({
  args: {
    table: moderationTableValidator,
    imageId: v.string(),
    attempt: v.number(),
    legacy: v.optional(v.boolean()),
  },
  handler: (ctx, { table, imageId, attempt, legacy }): Promise<boolean> =>
    armHashRecheck(ctx, table, imageId, {
      expected: legacy ? null : attempt,
      next: attempt + 1,
      runAfter: hashRecheckDelayMs(attempt + 1),
    }),
});

/**
 * Whether re-check `attempt` is the row's current one: a pool job must match the row's attempt; a
 * re-check scheduled before the pool existed (`pooled` false) runs only while none is armed.
 * Anything else is stale (superseded by a later attempt or by the sweep) and must do nothing.
 */
export const isCurrentHashRecheck = internalQuery({
  args: {
    table: moderationTableValidator,
    imageId: v.string(),
    attempt: v.number(),
    pooled: v.boolean(),
  },
  handler: async (ctx, { table, imageId, attempt, pooled }) => {
    const state = await loadRecheckState(ctx, table, imageId);
    if (!state) return false;
    return pooled ? state.attempt === attempt : state.attempt === undefined;
  },
});

/**
 * The pool's callback for a re-check that ended without success: it threw or crashed on every
 * try, or was canceled. The row keeps waiting, so the next attempt is armed on the schedule, as
 * for "unavailable" (unless the row moved on: published, quarantined, gone, or re-armed). One wide
 * event per call.
 */
export const onHashRecheckComplete = internalMutation({
  args: vOnCompleteArgs(
    v.object({
      table: moderationTableValidator,
      imageId: v.string(),
      attempt: v.number(),
    }),
  ),
  handler: async (ctx, { workId, context, result }) => {
    if (result.kind === "success") return;
    const { table, imageId, attempt } = context;
    const rearmed = await armHashRecheck(ctx, table, imageId, {
      expected: attempt,
      next: attempt + 1,
      runAfter: hashRecheckDelayMs(attempt + 1),
    });
    logEvent({
      event: "imageModeration.hashRecheckFailed",
      outcome: "error",
      table,
      image_id: imageId,
      work_id: workId,
      attempt,
      result_kind: result.kind,
      // The error text of the last try, cut short (no image data or hashes are ever in it).
      error: result.kind === "failed" ? result.error.slice(0, 500) : null,
      rearmed,
      next_recheck_in_ms: rearmed ? hashRecheckDelayMs(attempt + 1) : null,
    });
  },
});

const TABLES: readonly ModerationTable[] = [
  "copy",
  "completion",
  "boxArt",
  "message",
];

type WaitingRow = { id: string } & RecheckState;

type Page = {
  rows: WaitingRow[];
  isDone: boolean;
  continueCursor: string;
};

// One page of rows held for their hash check (the by_hash_check_pending index holds only those).
const waitingPage = async (
  ctx: MutationCtx,
  table: ModerationTable,
  cursor: string | null,
): Promise<Page> => {
  const paginationOpts = { numItems: HASH_RECHECK_SWEEP_PAGE, cursor };
  const page = await (() => {
    switch (table) {
      case "copy":
        return ctx.db
          .query("ownedPuzzleImages")
          .withIndex("by_hash_check_pending", (q) =>
            q.gt("hashCheckPendingSince", 0),
          )
          .paginate(paginationOpts);
      case "completion":
        return ctx.db
          .query("completionImages")
          .withIndex("by_hash_check_pending", (q) =>
            q.gt("hashCheckPendingSince", 0),
          )
          .paginate(paginationOpts);
      case "boxArt":
        return ctx.db
          .query("boxArtUploads")
          .withIndex("by_hash_check_pending", (q) =>
            q.gt("hashCheckPendingSince", 0),
          )
          .paginate(paginationOpts);
      case "message":
        return ctx.db
          .query("messageAttachments")
          .withIndex("by_hash_check_pending", (q) =>
            q.gt("hashCheckPendingSince", 0),
          )
          .paginate(paginationOpts);
    }
  })();
  const rows: WaitingRow[] = [];
  for (const row of page.page) {
    if (!("pendingHashes" in row) || !("moderationStatus" in row)) continue;
    rows.push({ id: row._id, ...recheckStateOf(row) });
  }
  return { rows, isDone: page.isDone, continueCursor: page.continueCursor };
};

/**
 * The daily backstop (crons.ts): re-arm, to run at once, every row still waiting on its hash check
 * whose re-check is lost: none armed (a chain from before the pool, or a pipeline attempt that
 * crashed after storing the hashes), or the current one due over HASH_RECHECK_LOST_AFTER_MS ago
 * (the pool lost the job and never called back). The re-arm supersedes whatever was armed, so a
 * job that turns up late is stale and does nothing. A lost row that has waited HASH_CHECK_TIMEOUT_MS
 * times out instead (armHashRecheck). One page per run, re-scheduling itself through
 * the tables; `now` is fixed for the whole run.
 */
export const sweepLostHashRechecks = internalMutation({
  args: {
    table: v.optional(moderationTableValidator),
    cursor: v.optional(v.union(v.string(), v.null())),
    now: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const table = args.table ?? TABLES[0];
    const now = args.now ?? Date.now();
    const page = await waitingPage(ctx, table, args.cursor ?? null);
    const rearmedIds: string[] = [];
    let waiting = 0;
    for (const row of page.rows) {
      if (!row.waiting) continue;
      waiting += 1;
      const lost =
        row.attempt === undefined ||
        row.dueAt === undefined ||
        row.dueAt < now - HASH_RECHECK_LOST_AFTER_MS;
      if (!lost) continue;
      const armed = await armHashRecheck(ctx, table, row.id, {
        expected: row.attempt ?? null,
        next: (row.attempt ?? 0) + 1,
        runAfter: 0,
      });
      if (armed) rearmedIds.push(row.id);
    }

    const nextTable = TABLES[TABLES.indexOf(table) + 1];
    if (!page.isDone) {
      await ctx.scheduler.runAfter(
        0,
        internal.lib.imageModeration.hashRecheckPool.sweepLostHashRechecks,
        { table, cursor: page.continueCursor, now },
      );
    } else if (nextTable !== undefined) {
      await ctx.scheduler.runAfter(
        0,
        internal.lib.imageModeration.hashRecheckPool.sweepLostHashRechecks,
        { table: nextTable, cursor: null, now },
      );
    }
    // One wide event per page; error level when it re-armed anything, so losses are alertable.
    logEvent({
      event: "imageModeration.hashRecheckSweep",
      outcome: rearmedIds.length > 0 ? "error" : "success",
      table,
      scanned: page.rows.length,
      waiting,
      rearmed: rearmedIds.length,
      rearmed_image_ids: rearmedIds,
      is_done: page.isDone && nextTable === undefined,
    });
  },
});
