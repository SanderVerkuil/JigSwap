import type { WorkId } from "@convex-dev/workpool";
import { convexTest, type TestConvex } from "convex-test";
import { Jimp } from "jimp";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  settleDueScheduled,
  withModerationPool,
} from "../test-fixtures/moderationPool";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import {
  MODERATION_HANDOFF_DELAY_MS,
  moderationPool,
  unscoredReasonOfFailure,
} from "./lib/imageModeration/moderationPool";
import { STALLED_AFTER_MS } from "./lib/imageModeration/stalledSweep";
import schema from "./schema";

// The moderation Workpool (lib/imageModeration/moderationPool) and its backstop sweep
// (lib/imageModeration/stalledSweep): a retryable failure throws inside the pool so the pool
// retries it, a definite verdict never does, a check that never completes ends "unscored" through
// the pool's onComplete, and a row left "pending" for 24 hours is stamped "stalled". The classifier
// is a stubbed global `fetch` (Hugging Face).

const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);
type T = TestConvex<typeof schema>;

const hfReplies = (reply: { nsfw: number } | { status: number }) =>
  vi.fn(async () =>
    "status" in reply
      ? new Response("{}", { status: reply.status })
      : new Response(JSON.stringify([{ label: "nsfw", score: reply.nsfw }]), {
          status: 200,
        }),
  );

let logs: string[] = [];
beforeEach(() => {
  logs = [];
  const capture = (...parts: unknown[]) => {
    logs.push(parts.map(String).join(" "));
  };
  vi.spyOn(console, "log").mockImplementation(capture);
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(capture);
  vi.stubEnv("AXIOM_API_KEY", "");
  vi.stubEnv("MODERATION_PROVIDER", "");
  vi.stubEnv("HF_MODERATION_TOKEN", "hf_test");
  vi.stubEnv("CSAM_HASHCHECK_PROVIDER", "");
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const eventsNamed = (name: string) =>
  logs
    .filter((line) => line.startsWith("{"))
    .map((line) => JSON.parse(line) as Record<string, unknown>)
    .filter((event) => event.event === name);

const storeJpeg = async (t: T) => {
  const image = new Jimp({
    width: 8,
    height: 8,
    color: Math.floor(Math.random() * 0xffffff) * 256 + 0xff,
  });
  const bytes = await image.getBuffer("image/jpeg");
  return (await t.run((ctx) =>
    ctx.storage.store(
      new Blob([new Uint8Array(bytes)], { type: "image/jpeg" }),
    ),
  )) as Id<"_storage">;
};

// A member, a copy of a puzzle, and the ids the photo rows of every moderated table need.
const seed = (t: T) =>
  t.run(async (ctx) => {
    const now = Date.now();
    const alice = await ctx.db.insert("users", {
      clerkId: "clerk_alice",
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
    return { alice, copy };
  });

const pendingCopyPhoto = async (
  t: T,
  fields: { updatedAt?: number; moderationAttempts?: number } = {},
) => {
  const { alice, copy } = await seed(t);
  const fileId = await storeJpeg(t);
  return t.run((ctx) =>
    ctx.db.insert("ownedPuzzleImages", {
      ownedPuzzleId: copy,
      uploaderId: alice,
      fileId,
      moderationStatus: "pending",
      hashCheckPendingSince: Date.now(),
      createdAt: Date.now(),
      updatedAt: fields.updatedAt ?? Date.now(),
      moderationAttempts: fields.moderationAttempts,
    }),
  );
};

const copyRow = (t: T, id: Id<"ownedPuzzleImages">) =>
  t.run((ctx) => ctx.db.get(id));

describe("the moderation job", () => {
  test("a retryable failure inside the pool throws, so the pool retries it; the row stays pending", async () => {
    vi.stubGlobal("fetch", hfReplies({ status: 503 }));
    const t = withModerationPool(convexTest(schema, modules));
    const imageId = await pendingCopyPhoto(t);

    await expect(
      t.action(internal.library.moderatePhoto.moderatePhoto, {
        imageId,
        pooled: true,
      }),
    ).rejects.toThrow("moderation_retryable:provider_error");

    const row = await copyRow(t, imageId);
    expect(row?.moderationStatus).toBe("pending");
    expect(row?.moderationAttempts).toBe(1);
    // The attempt still logged its wide event before throwing.
    expect(eventsNamed("library.moderatePhoto")).toEqual([
      expect.objectContaining({
        attempt: 1,
        decision: "retry",
        retry_reason: "provider_error",
      }),
    ]);
  });

  test("a definite verdict returns normally: nothing to retry", async () => {
    vi.stubGlobal("fetch", hfReplies({ status: 401 }));
    const t = withModerationPool(convexTest(schema, modules));
    const imageId = await pendingCopyPhoto(t);

    await t.action(internal.library.moderatePhoto.moderatePhoto, {
      imageId,
      pooled: true,
    });

    const row = await copyRow(t, imageId);
    expect(row?.moderationStatus).toBe("unscored");
    expect(row?.moderationReason).toBe("auth");
    expect(row?.moderationAttempts).toBe(1);
  });

  test("a retry scheduled before the pool existed hands its retry to the pool instead of throwing", async () => {
    vi.stubGlobal("fetch", hfReplies({ status: 429 }));
    const t = withModerationPool(convexTest(schema, modules));
    const imageId = await pendingCopyPhoto(t, { moderationAttempts: 1 });
    const enqueued = vi.spyOn(moderationPool, "enqueueAction");
    vi.useFakeTimers();

    // The pre-pool args: an explicit attempt, no `pooled`.
    await t.action(internal.library.moderatePhoto.moderatePhoto, {
      imageId,
      attempt: 2,
    });

    expect(enqueued).toHaveBeenCalledTimes(1);
    expect(enqueued.mock.calls[0][2]).toEqual({ imageId, pooled: true });
    expect(enqueued.mock.calls[0][3]).toMatchObject({
      runAfter: MODERATION_HANDOFF_DELAY_MS,
      context: { table: "copy", imageId },
    });
    expect((await copyRow(t, imageId))?.moderationAttempts).toBe(2);
  });

  test("a decided row is a no-op and is not counted again (idempotent)", async () => {
    const fetchMock = hfReplies({ nsfw: 0.01 });
    vi.stubGlobal("fetch", fetchMock);
    const t = withModerationPool(convexTest(schema, modules));
    const imageId = await pendingCopyPhoto(t);

    await t.action(internal.library.moderatePhoto.moderatePhoto, {
      imageId,
      pooled: true,
    });
    await t.action(internal.library.moderatePhoto.moderatePhoto, {
      imageId,
      pooled: true,
    });

    const row = await copyRow(t, imageId);
    expect(row?.moderationStatus).toBe("approved");
    expect(row?.moderationAttempts).toBe(1);
    expect(row?.reencodedAt).toEqual(expect.any(Number));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("onModerationComplete", () => {
  const complete = (
    t: T,
    imageId: string,
    result:
      | { kind: "failed"; error: string }
      | { kind: "canceled" }
      | { kind: "success"; returnValue: null },
  ) =>
    t.mutation(
      internal.lib.imageModeration.moderationPool.onModerationComplete,
      {
        workId: "work_1" as WorkId,
        context: { table: "copy", imageId },
        result,
      },
    );

  test("the reason of the failure: our retryable marker, else check_failed", () => {
    expect(
      unscoredReasonOfFailure(
        "Uncaught Error: moderation_retryable:rate_limited\n    at handler (x.js:1:1)",
      ),
    ).toBe("rate_limited");
    expect(unscoredReasonOfFailure("Action timed out")).toBe("check_failed");
    expect(unscoredReasonOfFailure("moderation_retryable:something_else")).toBe(
      "check_failed",
    );
  });

  test("a final failure stamps a pending row unscored with the reason and logs a wide event", async () => {
    const t = withModerationPool(convexTest(schema, modules));
    const imageId = await pendingCopyPhoto(t, { moderationAttempts: 4 });

    await complete(t, imageId, {
      kind: "failed",
      error: "Uncaught Error: moderation_retryable:network",
    });

    const row = await copyRow(t, imageId);
    expect(row?.moderationStatus).toBe("unscored");
    expect(row?.moderationReason).toBe("network");
    expect(row?.moderationAttempts).toBe(4);
    expect(eventsNamed("imageModeration.checkFailed")).toEqual([
      expect.objectContaining({
        outcome: "error",
        table: "copy",
        image_id: imageId,
        result_kind: "failed",
        unscored_reason: "network",
        stamped: true,
      }),
    ]);
  });

  test("a crash or a cancel is check_failed", async () => {
    const t = withModerationPool(convexTest(schema, modules));
    const crashed = await pendingCopyPhoto(t);
    const canceled = await pendingCopyPhoto(t);

    await complete(t, crashed, { kind: "failed", error: "Transient error" });
    await complete(t, canceled, { kind: "canceled" });

    expect((await copyRow(t, crashed))?.moderationReason).toBe("check_failed");
    expect((await copyRow(t, canceled))?.moderationReason).toBe("check_failed");
  });

  test("a row with a verdict is left alone (first verdict wins)", async () => {
    const t = withModerationPool(convexTest(schema, modules));
    const imageId = await pendingCopyPhoto(t);
    await t.run((ctx) =>
      ctx.db.patch(imageId, {
        moderationStatus: "approved",
        moderationScore: 0.01,
      }),
    );

    await complete(t, imageId, { kind: "failed", error: "Transient error" });

    const row = await copyRow(t, imageId);
    expect(row?.moderationStatus).toBe("approved");
    expect(row?.moderationReason).toBeUndefined();
    expect(eventsNamed("imageModeration.checkFailed")).toEqual([
      expect.objectContaining({ stamped: false }),
    ]);
  });

  test("end to end: a job that fails on every attempt is retried by the pool, then stamped check_failed", async () => {
    const t = withModerationPool(convexTest(schema, modules));
    const imageId = await pendingCopyPhoto(t);
    vi.useFakeTimers();

    // A job that can never run (its arguments fail validation) stands in for one that crashes
    // every time: the pool retries it, then reports the final failure.
    await t.run((ctx) =>
      moderationPool.enqueueAction(
        ctx,
        internal.library.moderatePhoto.moderatePhoto,
        { imageId: "not-an-id" as Id<"ownedPuzzleImages">, pooled: true },
        {
          onComplete:
            internal.lib.imageModeration.moderationPool.onModerationComplete,
          onCompleteExcludeKinds: ["success"],
          context: { table: "copy", imageId },
        },
      ),
    );
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const row = await copyRow(t, imageId);
    expect(row?.moderationStatus).toBe("unscored");
    expect(row?.moderationReason).toBe("check_failed");
  });
});

describe("the stalled sweep", () => {
  const sweep = (t: T, cutoff?: number) =>
    t.mutation(
      internal.lib.imageModeration.stalledSweep.sweepStalledModeration,
      cutoff === undefined ? {} : { cutoff },
    );

  // One pending row in every moderated table, last touched `touchedAt`.
  const pendingEverywhere = async (t: T, touchedAt: number) => {
    const { alice, copy } = await seed(t);
    return t.run(async (ctx) => {
      const fileId = await ctx.storage.store(new Blob(["x"]));
      const base = {
        uploaderId: alice,
        fileId,
        moderationStatus: "pending" as const,
        createdAt: touchedAt,
        updatedAt: touchedAt,
      };
      return {
        copy: await ctx.db.insert("ownedPuzzleImages", {
          ...base,
          ownedPuzzleId: copy,
        }),
        completion: await ctx.db.insert("completionImages", {
          ...base,
          completionId: crypto.randomUUID(),
        }),
        boxArt: await ctx.db.insert("boxArtUploads", {
          storageId: fileId,
          uploaderId: alice,
          moderationStatus: "pending",
          createdAt: touchedAt,
        }),
        message: await ctx.db.insert("messageAttachments", {
          ...base,
          kind: "image",
          threadAggregateId: crypto.randomUUID(),
          byteSize: 1,
          contentType: "image/jpeg",
        }),
      };
    });
  };

  const statuses = (t: T, ids: Awaited<ReturnType<typeof pendingEverywhere>>) =>
    t.run(async (ctx) => {
      const rows = [
        await ctx.db.get(ids.copy),
        await ctx.db.get(ids.completion),
        await ctx.db.get(ids.boxArt),
        await ctx.db.get(ids.message),
      ];
      return rows.map((row) =>
        row && "moderationStatus" in row
          ? [row.moderationStatus, row.moderationReason ?? null]
          : null,
      );
    });

  // A run 24 hours from now uses a cutoff after these rows were created (so the index range
  // reads them all); each row's touch timestamp then decides.
  const laterCutoff = () => Date.now() + 1000;

  test("stamps rows pending for over 24 hours in every table, leaves fresh ones", async () => {
    const t = withModerationPool(convexTest(schema, modules));
    const cutoff = laterCutoff();
    const stale = await pendingEverywhere(t, cutoff - 60_000);
    const fresh = await pendingEverywhere(t, cutoff + 60_000);

    await sweep(t, cutoff);
    await settleDueScheduled(t);

    expect(await statuses(t, stale)).toEqual([
      ["unscored", "stalled"],
      ["unscored", "stalled"],
      ["unscored", "stalled"],
      ["unscored", "stalled"],
    ]);
    expect(await statuses(t, fresh)).toEqual([
      ["pending", null],
      ["pending", null],
      ["pending", null],
      ["pending", null],
    ]);
    const pages = eventsNamed("imageModeration.stalledSweep");
    expect(pages.map((page) => [page.table, page.stamped])).toEqual([
      ["copy", 1],
      ["completion", 1],
      ["boxArt", 1],
      ["message", 1],
    ]);
    expect(pages[pages.length - 1]?.is_done).toBe(true);
  });

  test("a row touched since (an admin re-check) is left for a later run", async () => {
    const t = withModerationPool(convexTest(schema, modules));
    const cutoff = laterCutoff();
    const ids = await pendingEverywhere(t, cutoff - 60_000);
    await t.run(async (ctx) => {
      await ctx.db.patch(ids.copy, { updatedAt: cutoff + 1 });
      await ctx.db.patch(ids.boxArt, { recheckedAt: cutoff + 1 });
    });

    await sweep(t, cutoff);
    await settleDueScheduled(t);

    expect(await statuses(t, ids)).toEqual([
      ["pending", null],
      ["unscored", "stalled"],
      ["pending", null],
      ["unscored", "stalled"],
    ]);
  });

  test("decided rows are untouched and a second run changes nothing (idempotent)", async () => {
    const t = withModerationPool(convexTest(schema, modules));
    const cutoff = laterCutoff();
    const ids = await pendingEverywhere(t, cutoff - 60_000);
    await t.run((ctx) =>
      ctx.db.patch(ids.copy, {
        moderationStatus: "approved",
        moderationScore: 0.01,
      }),
    );

    await sweep(t, cutoff);
    await settleDueScheduled(t);
    const after = await statuses(t, ids);
    await sweep(t, cutoff);
    await settleDueScheduled(t);

    expect(after).toEqual([
      ["approved", null],
      ["unscored", "stalled"],
      ["unscored", "stalled"],
      ["unscored", "stalled"],
    ]);
    expect(await statuses(t, ids)).toEqual(after);
    expect(
      eventsNamed("imageModeration.stalledSweep").map((page) => page.stamped),
    ).toEqual([0, 1, 1, 1, 0, 0, 0, 0]);
  });

  test("the cron's own run (no cutoff) leaves rows created within the last day alone", async () => {
    const t = withModerationPool(convexTest(schema, modules));
    const ids = await pendingEverywhere(t, Date.now() - 2 * STALLED_AFTER_MS);

    await sweep(t);
    await settleDueScheduled(t);

    // Their touch timestamps are old, but they were CREATED just now (_creationTime).
    expect(await statuses(t, ids)).toEqual([
      ["pending", null],
      ["pending", null],
      ["pending", null],
      ["pending", null],
    ]);
  });
});
