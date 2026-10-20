import type { WorkId } from "@convex-dev/workpool";
import { convexTest, type TestConvex } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { withModerationPool } from "../test-fixtures/moderationPool";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import type {
  CsamHashCheckPort,
  CsamHashCheckResult,
} from "./lib/imageModeration/csamHashCheck";
import {
  HASH_RECHECK_DELAYS_MS,
  HASH_RECHECK_LOST_AFTER_MS,
  HASH_RECHECK_RETRY,
  hashRecheckPool,
} from "./lib/imageModeration/hashRecheckPool";
import schema from "./schema";

// The CSAM hash RE-check on its own Workpool (lib/imageModeration/hashRecheckPool): the STORED
// hashes of a photo whose hash check was unavailable are re-checked on HASH_RECHECK_DELAYS_MS,
// one current attempt per row; a crash is retried by the pool, a give-up arms the next attempt
// (the row keeps waiting, never stuck), a match quarantines and escalates without a word to the
// uploader, and the daily sweep re-arms a re-check that was lost.
//
// The hash service is a FAKE PORT: makeCsamHashCheckPortFromEnv returns `fakePort`, which answers
// from `hcs.replies` (then `hcs.fallback`). `hcs.crashes` makes that many re-checks throw before
// they reach the port, standing in for an attempt that crashed.

const hcs = vi.hoisted(() => ({
  replies: [] as CsamHashCheckResult["status"][],
  fallback: "no_match" as CsamHashCheckResult["status"],
  crashes: 0,
  checks: 0,
}));

vi.mock("./lib/imageModeration/csamHashCheck", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("./lib/imageModeration/csamHashCheck")
    >();
  const fakePort: CsamHashCheckPort = {
    provider: "offlimits",
    check: async () => {
      hcs.checks += 1;
      const status = hcs.replies.shift() ?? hcs.fallback;
      return status === "unavailable"
        ? { status, reason: "http_503" }
        : { status };
    },
  };
  return {
    ...actual,
    makeCsamHashCheckPortFromEnv: () => fakePort,
    checkAllHashes: async (
      ...args: Parameters<typeof actual.checkAllHashes>
    ) => {
      if (hcs.crashes > 0) {
        hcs.crashes -= 1;
        throw new Error("hash re-check crashed");
      }
      return actual.checkAllHashes(...args);
    },
  };
});

const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);
type T = TestConvex<typeof schema>;

let logs: string[] = [];
beforeEach(() => {
  logs = [];
  hcs.replies = [];
  hcs.fallback = "no_match";
  hcs.crashes = 0;
  hcs.checks = 0;
  const capture = (...parts: unknown[]) => {
    logs.push(parts.map(String).join(" "));
  };
  vi.spyOn(console, "log").mockImplementation(capture);
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(capture);
  vi.stubEnv("AXIOM_API_KEY", "");
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const eventsNamed = (name: string) =>
  logs
    .filter((line) => line.startsWith("{"))
    .map((line) => JSON.parse(line) as Record<string, unknown>)
    .filter((event) => event.event === name);

const HASHES = [
  { md5: "a".repeat(32), sha1: "b".repeat(40) },
  { md5: "c".repeat(32), sha1: "d".repeat(40) },
];

// A copy photo the classifier approved, held unpublished because its hash check was
// unavailable: the re-encode is stored, the hashes of the original and the re-encode wait.
const waitingCopyPhoto = async (
  t: T,
  fields: {
    hashRecheckAttempt?: number;
    hashRecheckDueAt?: number;
    hashCheckedAt?: number;
    moderationStatus?: "approved" | "quarantined";
  } = {},
) =>
  t.run(async (ctx) => {
    const now = Date.now();
    const alice = await ctx.db.insert("users", {
      clerkId: `clerk_${crypto.randomUUID()}`,
      email: "alice@example.com",
      name: "Alice",
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    const puzzleAggregateId = crypto.randomUUID();
    const puzzleId = await ctx.db.insert("puzzles", {
      aggregateId: puzzleAggregateId,
      title: "Mountain Vista",
      pieceCount: 1000,
      status: "approved",
      submittedBy: alice,
      createdAt: now,
      updatedAt: now,
    });
    const copy = await ctx.db.insert("ownedPuzzles", {
      aggregateId: crypto.randomUUID(),
      puzzleDefinitionId: puzzleAggregateId,
      puzzleId,
      ownerId: alice,
      condition: "good",
      availability: { forTrade: false, forSale: false, forLend: false },
      visibility: "visible",
      snapshot: { title: "Mountain Vista", pieceCount: 1000 },
      createdAt: now,
      updatedAt: now,
    });
    const fileId = await ctx.storage.store(
      new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], {
        type: "image/jpeg",
      }),
    );
    return ctx.db.insert("ownedPuzzleImages", {
      ownedPuzzleId: copy,
      uploaderId: alice,
      fileId,
      moderationStatus: fields.moderationStatus ?? "approved",
      moderationScore: 0.01,
      reencodedAt: now,
      hashCheckPendingSince: now,
      pendingHashes: HASHES,
      hashCheckedAt: fields.hashCheckedAt,
      hashRecheckAttempt: fields.hashRecheckAttempt,
      hashRecheckDueAt: fields.hashRecheckDueAt,
      createdAt: now,
      updatedAt: now,
    });
  });

const row = (t: T, id: Id<"ownedPuzzleImages">) =>
  t.run((ctx) => ctx.db.get(id));

const start = (t: T, imageId: Id<"ownedPuzzleImages">) =>
  t.mutation(internal.lib.imageModeration.hashRecheckPool.startHashRecheck, {
    table: "copy",
    imageId,
  });

const recheck = (
  t: T,
  imageId: Id<"ownedPuzzleImages">,
  attempt: number,
  pooled = true,
) =>
  t.action(internal.library.moderatePhoto.recheckHashes, {
    imageId,
    attempt,
    pooled,
  });

// Run every scheduled function and pool job to the end, the delayed re-checks included.
const runAll = (t: T) => t.finishAllScheduledFunctions(vi.runAllTimers);

describe("arming the re-check", () => {
  test("the first re-check is armed once, 15 minutes out, on the hash re-check pool", async () => {
    const t = withModerationPool(convexTest(schema, modules));
    const imageId = await waitingCopyPhoto(t);
    const enqueued = vi.spyOn(hashRecheckPool, "enqueueAction");

    expect(await start(t, imageId)).toBe(true);
    expect(await start(t, imageId)).toBe(false);

    expect(enqueued).toHaveBeenCalledTimes(1);
    expect(enqueued.mock.calls[0][2]).toEqual({
      imageId,
      attempt: 1,
      pooled: true,
    });
    expect(enqueued.mock.calls[0][3]).toMatchObject({
      runAfter: HASH_RECHECK_DELAYS_MS[0],
      context: { table: "copy", imageId, attempt: 1 },
    });
    const after = await row(t, imageId);
    expect(after?.hashRecheckAttempt).toBe(1);
    expect(after!.hashRecheckDueAt! - Date.now()).toBeGreaterThan(14 * 60_000);
  });

  test("still unavailable arms the next attempt exactly once, even when the same attempt finishes twice", async () => {
    hcs.fallback = "unavailable";
    const t = withModerationPool(convexTest(schema, modules));
    const imageId = await waitingCopyPhoto(t, { hashRecheckAttempt: 1 });
    const enqueued = vi.spyOn(hashRecheckPool, "enqueueAction");

    await recheck(t, imageId, 1);
    // A second run of attempt 1 (say, a pool retry racing a late success) is stale now.
    await recheck(t, imageId, 1);

    expect(enqueued).toHaveBeenCalledTimes(1);
    expect(enqueued.mock.calls[0][3]).toMatchObject({
      runAfter: HASH_RECHECK_DELAYS_MS[1],
      context: { attempt: 2 },
    });
    expect((await row(t, imageId))?.hashRecheckAttempt).toBe(2);
    expect(hcs.checks).toBe(2); // one run, both stored hash pairs
    expect(
      eventsNamed("library.moderatePhoto.hashRecheck").map((e) => e.result),
    ).toEqual([undefined, "skipped_stale"]);
  });
});

describe("stale and legacy re-checks (idempotent)", () => {
  test("a job whose attempt is not the row's does nothing", async () => {
    hcs.fallback = "match";
    const t = withModerationPool(convexTest(schema, modules));
    const imageId = await waitingCopyPhoto(t, { hashRecheckAttempt: 3 });

    await recheck(t, imageId, 2);

    expect(hcs.checks).toBe(0);
    const after = await row(t, imageId);
    expect(after?.moderationStatus).toBe("approved");
    expect(after?.hashRecheckAttempt).toBe(3);
  });

  test("a re-check scheduled before the pool existed runs once and hands the next attempt to the pool", async () => {
    hcs.fallback = "unavailable";
    const t = withModerationPool(convexTest(schema, modules));
    const imageId = await waitingCopyPhoto(t);
    const enqueued = vi.spyOn(hashRecheckPool, "enqueueAction");

    // The pre-pool args: an attempt, no `pooled`.
    await t.action(internal.library.moderatePhoto.recheckHashes, {
      imageId,
      attempt: 4,
    });

    expect(enqueued).toHaveBeenCalledTimes(1);
    expect(enqueued.mock.calls[0][2]).toEqual({
      imageId,
      attempt: 5,
      pooled: true,
    });
    expect((await row(t, imageId))?.hashRecheckAttempt).toBe(5);

    // Once the pool owns the row, a leftover pre-pool re-check is stale.
    await recheck(t, imageId, 5, false);
    expect(enqueued).toHaveBeenCalledTimes(1);
  });

  test("a published or quarantined row is skipped", async () => {
    hcs.fallback = "match";
    const t = withModerationPool(convexTest(schema, modules));
    const published = await waitingCopyPhoto(t, {
      hashRecheckAttempt: 1,
      hashCheckedAt: Date.now(),
    });
    const quarantined = await waitingCopyPhoto(t, {
      hashRecheckAttempt: 1,
      moderationStatus: "quarantined",
    });

    await recheck(t, published, 1);
    await recheck(t, quarantined, 1);

    expect(hcs.checks).toBe(0);
    expect(
      await t.run((ctx) => ctx.db.query("csamEscalations").collect()),
    ).toEqual([]);
  });
});

describe("on the pool", () => {
  test("unavailable, then no_match: re-checked on the schedule until the photo is published", async () => {
    hcs.replies = ["unavailable", "unavailable"];
    hcs.fallback = "no_match";
    const t = withModerationPool(convexTest(schema, modules));
    const imageId = await waitingCopyPhoto(t);
    vi.useFakeTimers();

    await start(t, imageId);
    await runAll(t);

    const after = await row(t, imageId);
    expect(after?.hashCheckedAt).toEqual(expect.any(Number));
    expect(after?.pendingHashes).toBeUndefined();
    expect(after?.hashRecheckAttempt).toBe(2);
    expect(
      eventsNamed("library.moderatePhoto.hashRecheck").map((e) => [
        e.attempt,
        e.csam_hashcheck_status,
      ]),
    ).toEqual([
      [1, "unavailable"],
      [2, "no_match"],
    ]);
  });

  test("a match quarantines and escalates, tells the uploader nothing, and arms nothing more", async () => {
    hcs.fallback = "match";
    const t = withModerationPool(convexTest(schema, modules));
    const imageId = await waitingCopyPhoto(t);
    const before = await row(t, imageId);
    vi.useFakeTimers();

    await start(t, imageId);
    await runAll(t);

    const after = await row(t, imageId);
    expect(after?.moderationStatus).toBe("quarantined");
    expect(after?.pendingHashes).toBeUndefined();
    expect(after?.hashRecheckAttempt).toBe(1);
    // The bytes are preserved under a NEW blob; the one the row held is gone.
    expect(after?.fileId).not.toBe(before?.fileId);
    const escalations = await t.run((ctx) =>
      ctx.db.query("csamEscalations").collect(),
    );
    expect(escalations).toEqual([
      expect.objectContaining({
        table: "ownedPuzzleImages",
        fileId: after?.fileId,
        md5: HASHES[0].md5,
        originalDiscarded: true,
      }),
    ]);
    expect(
      await t.run((ctx) => ctx.db.query("notifications").collect()),
    ).toEqual([]);
    // The wide event carries the escalation id only, nothing that identifies the row.
    const [event] = eventsNamed("library.moderatePhoto.hashRecheck");
    expect(event).toMatchObject({
      csam_hashcheck_status: "match",
      escalation_id: escalations[0]._id,
    });
    expect(event.image_id).toBeUndefined();
  });

  test("a re-check that crashes is retried by the pool", async () => {
    hcs.crashes = 1;
    hcs.fallback = "no_match";
    const t = withModerationPool(convexTest(schema, modules));
    const imageId = await waitingCopyPhoto(t);
    vi.useFakeTimers();

    await start(t, imageId);
    await runAll(t);

    const after = await row(t, imageId);
    expect(after?.hashCheckedAt).toEqual(expect.any(Number));
    // The same attempt, retried: nothing was re-armed and the pool never gave up.
    expect(after?.hashRecheckAttempt).toBe(1);
    expect(
      eventsNamed("library.moderatePhoto.hashRecheck").map((e) => [
        e.attempt,
        (e.error as { stage?: string } | undefined)?.stage ?? null,
        e.csam_hashcheck_status ?? null,
      ]),
    ).toEqual([
      [1, "recheck", null],
      [1, null, "no_match"],
    ]);
    expect(eventsNamed("imageModeration.hashRecheckFailed")).toEqual([]);
  });

  test("when the pool gives up, the next attempt is armed on the schedule: the photo keeps waiting, never stuck", async () => {
    hcs.crashes = HASH_RECHECK_RETRY.maxAttempts;
    hcs.fallback = "no_match";
    const t = withModerationPool(convexTest(schema, modules));
    const imageId = await waitingCopyPhoto(t);
    vi.useFakeTimers();

    await start(t, imageId);
    await runAll(t);

    expect(eventsNamed("imageModeration.hashRecheckFailed")).toEqual([
      expect.objectContaining({
        outcome: "error",
        table: "copy",
        image_id: imageId,
        attempt: 1,
        result_kind: "failed",
        rearmed: true,
        next_recheck_in_ms: HASH_RECHECK_DELAYS_MS[1],
      }),
    ]);
    // Attempt 2 then found the service answering and published the photo.
    const after = await row(t, imageId);
    expect(after?.hashRecheckAttempt).toBe(2);
    expect(after?.hashCheckedAt).toEqual(expect.any(Number));
  });
});

describe("onHashRecheckComplete", () => {
  const complete = (
    t: T,
    imageId: string,
    attempt: number,
    result: { kind: "failed"; error: string } | { kind: "canceled" },
  ) =>
    t.mutation(
      internal.lib.imageModeration.hashRecheckPool.onHashRecheckComplete,
      {
        workId: "work_1" as WorkId,
        context: { table: "copy", imageId, attempt },
        result,
      },
    );

  test("a give-up or a cancel arms the next attempt, as unavailable would", async () => {
    const t = withModerationPool(convexTest(schema, modules));
    const failed = await waitingCopyPhoto(t, { hashRecheckAttempt: 8 });
    const canceled = await waitingCopyPhoto(t, { hashRecheckAttempt: 1 });

    await complete(t, failed, 8, { kind: "failed", error: "Action timed out" });
    await complete(t, canceled, 1, { kind: "canceled" });

    const afterFailed = await row(t, failed);
    expect(afterFailed?.hashRecheckAttempt).toBe(9);
    // Past the schedule's end: every 24 hours.
    expect(afterFailed!.hashRecheckDueAt! - Date.now()).toBeGreaterThan(
      23 * 3_600_000,
    );
    expect((await row(t, canceled))?.hashRecheckAttempt).toBe(2);
  });

  test("a row that moved on (published, re-armed) is left alone", async () => {
    const t = withModerationPool(convexTest(schema, modules));
    const published = await waitingCopyPhoto(t, {
      hashRecheckAttempt: 1,
      hashCheckedAt: Date.now(),
    });
    const rearmed = await waitingCopyPhoto(t, { hashRecheckAttempt: 3 });
    const enqueued = vi.spyOn(hashRecheckPool, "enqueueAction");

    await complete(t, published, 1, { kind: "failed", error: "x" });
    await complete(t, rearmed, 2, { kind: "failed", error: "x" });

    expect(enqueued).not.toHaveBeenCalled();
    expect((await row(t, rearmed))?.hashRecheckAttempt).toBe(3);
    expect(
      eventsNamed("imageModeration.hashRecheckFailed").map((e) => e.rearmed),
    ).toEqual([false, false]);
  });
});

describe("the sweeps", () => {
  const sweepCopy = (t: T, now: number) =>
    t.mutation(
      internal.lib.imageModeration.hashRecheckPool.sweepLostHashRechecks,
      { table: "copy", now },
    );

  test("re-arms waiting rows whose re-check was lost, at once; leaves armed, published and quarantined rows alone", async () => {
    const t = withModerationPool(convexTest(schema, modules));
    const now = Date.now();
    const neverArmed = await waitingCopyPhoto(t);
    const overdue = await waitingCopyPhoto(t, {
      hashRecheckAttempt: 3,
      hashRecheckDueAt: now - HASH_RECHECK_LOST_AFTER_MS - 1,
    });
    const armed = await waitingCopyPhoto(t, {
      hashRecheckAttempt: 2,
      hashRecheckDueAt: now + 60_000,
    });
    const published = await waitingCopyPhoto(t, {
      hashCheckedAt: now,
    });
    const quarantined = await waitingCopyPhoto(t, {
      moderationStatus: "quarantined",
    });
    const enqueued = vi.spyOn(hashRecheckPool, "enqueueAction");

    await sweepCopy(t, now);

    expect(
      enqueued.mock.calls.map((call) => [call[2].imageId, call[2].attempt]),
    ).toEqual(
      expect.arrayContaining([
        [neverArmed, 1],
        [overdue, 4],
      ]),
    );
    expect(enqueued).toHaveBeenCalledTimes(2);
    expect(enqueued.mock.calls.every((call) => call[3]?.runAfter === 0)).toBe(
      true,
    );
    expect((await row(t, armed))?.hashRecheckAttempt).toBe(2);
    expect((await row(t, published))?.hashRecheckAttempt).toBeUndefined();
    expect((await row(t, quarantined))?.hashRecheckAttempt).toBeUndefined();
    expect(eventsNamed("imageModeration.hashRecheckSweep")).toEqual([
      expect.objectContaining({
        table: "copy",
        waiting: 3,
        rearmed: 2,
        outcome: "error",
      }),
    ]);

    // A second run finds every waiting row armed: nothing to do (idempotent).
    await sweepCopy(t, now);
    expect(enqueued).toHaveBeenCalledTimes(2);
  });

  test("the stalled sweep leaves a photo the classifier approved but that waits on its hash check alone", async () => {
    const t = withModerationPool(convexTest(schema, modules));
    const imageId = await waitingCopyPhoto(t, { hashRecheckAttempt: 1 });

    await t.mutation(
      internal.lib.imageModeration.stalledSweep.sweepStalledModeration,
      { table: "copy", cutoff: Date.now() + 1000 },
    );

    const after = await row(t, imageId);
    expect(after?.moderationStatus).toBe("approved");
    expect(after?.pendingHashes).toEqual(HASHES);
    expect(after?.hashRecheckAttempt).toBe(1);
  });
});
