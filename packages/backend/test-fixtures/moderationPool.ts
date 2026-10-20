import type { WorkId } from "@convex-dev/workpool";
import workpoolTest from "@convex-dev/workpool/test";
import type { TestConvex } from "convex-test";
import type { GenericSchema, SchemaDefinition } from "convex/server";
import { hashRecheckPool } from "../convex/lib/imageModeration/hashRecheckPool";
import { moderationPool } from "../convex/lib/imageModeration/moderationPool";

type AnyTestConvex = TestConvex<SchemaDefinition<GenericSchema, boolean>>;

// The pool jobs enqueued since the current test's withModerationPool (on either pool), with when
// each is due.
// Tests in a file run one after another, so one list (reset per test instance) is enough.
type Pool = typeof moderationPool;
let enqueued: { pool: Pool; id: WorkId; dueAt: number }[] = [];
let tracking = false;

// Record every enqueue on both pools, so settleDueScheduled can ask the pool about it.
const trackEnqueues = () => {
  if (tracking) return;
  tracking = true;
  for (const pool of [moderationPool, hashRecheckPool]) {
    const enqueue = pool.enqueueAction.bind(pool);
    pool.enqueueAction = (async (...args: Parameters<typeof enqueue>) => {
      const id = await enqueue(...args);
      const runAfter = (args[3] as { runAfter?: number } | undefined)?.runAfter;
      enqueued.push({ pool, id, dueAt: Date.now() + (runAfter ?? 0) });
      return id;
    }) as Pool["enqueueAction"];
  }
};

// Every photo-moderation check runs on the moderationWorkpool component
// (convex/lib/imageModeration/moderationPool.ts), and every CSAM hash re-check on the
// hashRecheckWorkpool component (hashRecheckPool.ts), so a convex-test instance that uploads,
// re-checks or restores a photo needs both registered under the names convex.config.ts gives them.
//
// Each pool runs one job at a time here: convex-test serialises transactions globally, and two
// moderation actions storing blobs at once trip its "Write outside of transaction" guard.
export const withModerationPool = <T extends AnyTestConvex>(t: T): T => {
  workpoolTest.register(t, "moderationWorkpool");
  workpoolTest.register(t, "hashRecheckWorkpool");
  moderationPool.options.maxParallelism = 1;
  hashRecheckPool.options.maxParallelism = 1;
  trackEnqueues();
  enqueued = [];
  return t;
};

// Whether a pool job is running, or waiting and already due. A job waiting after a failed attempt
// is on the pool's backoff (a minute or more): not due within a test on real timers.
const poolBusy = async (t: AnyTestConvex): Promise<boolean> => {
  if (enqueued.length === 0) return false;
  const jobs = [...enqueued];
  const statuses = await t.run(async (ctx) =>
    Promise.all(jobs.map((job) => job.pool.status(ctx, job.id))),
  );
  return statuses.some(
    (status, i) =>
      status.state === "running" ||
      (status.state === "pending" &&
        status.previousAttempts === 0 &&
        jobs[i].dueAt <= Date.now()),
  );
};

// Real time in a row with nothing due before the scheduler counts as settled: covers the pool's
// own hops between its jobs (its main loop runs on 100 ms segments).
const QUIET_MS = 150;

/**
 * Run every scheduled function that is DUE, the moderation pool's jobs included, and return the
 * app's scheduled jobs. A job scheduled for later (a backoff retry minutes away) stays scheduled.
 */
export const settleDueScheduled = async <T extends AnyTestConvex>(t: T) => {
  let quietSince = Date.now();
  for (let i = 0; i < 2000; i++) {
    await t.finishInProgressScheduledFunctions();
    const jobs = await t.run((ctx) =>
      ctx.db.system.query("_scheduled_functions").collect(),
    );
    const busy =
      jobs.some(
        (job) =>
          job.state.kind === "inProgress" ||
          (job.state.kind === "pending" && job.scheduledTime <= Date.now()),
      ) || (await poolBusy(t));
    if (busy) quietSince = Date.now();
    else if (Date.now() - quietSince >= QUIET_MS) return jobs;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("scheduled functions did not settle");
};
