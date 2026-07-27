import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

// Bundle every Convex module for the in-memory runtime, excluding test files.
const modules = import.meta.glob(["./**/*.{js,ts}", "!./**/*.test.{js,ts}"]);

// Verdict-store tests for the completion-photo moderation pipeline. The store mutations are
// called DIRECTLY via `internal.*` — but note convex-test DOES drain runAfter(0) jobs in the
// background (real setTimeout), so the scheduled action runs during these tests and fails open
// (env-less + non-image bytes: verdict-only approve, never "rejected", no file swap). The tests
// stay deterministic by settling all scheduled jobs to a terminal state and resetting the
// sidecar to "pending" before each direct verdict call, combined with setModerationVerdict's
// first-wins-on-pending guard (a late re-run can never overwrite a decided verdict).

// Seed a member + a catalog puzzle + an owned copy (with a snapshot title, which the rejection
// stamp uses as targetLabel via the completion's copySnapshot).
const seed = async (t: ReturnType<typeof convexTest>) =>
  t.run(async (ctx) => {
    const now = Date.now();
    const alice = await ctx.db.insert("users", {
      clerkId: "clerk_alice",
      email: "alice@example.com",
      name: "alice",
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
    const copyAggregateId = crypto.randomUUID();
    await ctx.db.insert("ownedPuzzles", {
      aggregateId: copyAggregateId,
      puzzleDefinitionId: puzzleAggregateId,
      puzzleId,
      ownerId: alice,
      condition: "good",
      availability: { forTrade: false, forSale: false, forLend: false },
      visibility: "private",
      snapshot: {
        title: "Mountain Vista",
        pieceCount: 1000,
      },
      createdAt: now,
      updatedAt: now,
    });
    return { alice, copyAggregateId };
  });

const asAlice = (t: ReturnType<typeof convexTest>) =>
  t.withIdentity({ subject: "clerk_alice" });

const HOUR = 60 * 60 * 1000;

const recordForAlice = async (
  t: ReturnType<typeof convexTest>,
  copyAggregateId: string,
) =>
  (await asAlice(t).mutation(api.solving.recordCompletion.recordCompletion, {
    copyId: copyAggregateId,
    startDate: Date.now() - 2 * HOUR,
    endDate: Date.now() - HOUR,
  })) as string;

// Unique content per blob — convex-test content-addresses storage, so identical bytes would
// yield identical URLs and blunt the "which photo survived" assertions below.
const storeBlob = (t: ReturnType<typeof convexTest>) =>
  t.run((ctx) =>
    ctx.storage.store(new Blob([crypto.randomUUID()], { type: "image/png" })),
  );

const completionRow = (t: ReturnType<typeof convexTest>, aggregateId: string) =>
  t.run(async (ctx) =>
    ctx.db
      .query("completions")
      .withIndex("by_aggregate_id", (q) => q.eq("aggregateId", aggregateId))
      .unique(),
  );

const completionImagesFor = (
  t: ReturnType<typeof convexTest>,
  completionId: string,
) =>
  t.run(async (ctx) =>
    ctx.db
      .query("completionImages")
      .withIndex("by_completion", (q) => q.eq("completionId", completionId))
      .collect(),
  );

const moderationActions = (t: ReturnType<typeof convexTest>) =>
  t.run((ctx) => ctx.db.query("moderationActions").collect());

// Wait until every scheduled job reaches a terminal state. convex-test starts runAfter(0) jobs
// via real setTimeout; finishInProgressScheduledFunctions only awaits jobs whose timer already
// fired, so yield through the macrotask queue between rounds to let pending timers fire too.
const settleScheduledJobs = async (t: ReturnType<typeof convexTest>) => {
  for (let i = 0; i < 100; i++) {
    await t.finishInProgressScheduledFunctions();
    const jobs = await t.run((ctx) =>
      ctx.db.system.query("_scheduled_functions").collect(),
    );
    if (
      jobs.every(
        (job) =>
          job.state.kind !== "pending" && job.state.kind !== "inProgress",
      )
    ) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error("scheduled functions did not settle");
};

// Attach one photo and return its sidecar row, reset to "pending": the background-drained
// action fail-open-approves it (verdict-only — decode fails on non-image bytes, so no file
// swap), so settle that job first, then re-open the sidecar so each test exercises the FIRST
// verdict deterministically.
const attachOne = async (
  t: ReturnType<typeof convexTest>,
  completionId: string,
) => {
  const fileId = (await storeBlob(t)) as Id<"_storage">;
  await asAlice(t).mutation(
    api.solving.attachCompletionPhotos.attachCompletionPhotos,
    { completionId, storageIds: [fileId] },
  );
  await settleScheduledJobs(t);
  const images = await completionImagesFor(t, completionId);
  const sidecar = images.find((img) => img.fileId === fileId);
  if (!sidecar) throw new Error("sidecar not inserted by attach");
  await t.run((ctx) =>
    ctx.db.patch(sidecar._id, { moderationStatus: "pending" }),
  );
  return { fileId, sidecar };
};

describe("completionModerationStore.setModerationFile (approve-with-swap)", () => {
  test("swaps the sidecar fileId AND the completions.photos entry, bumping updatedAt", async () => {
    const t = convexTest(schema, modules);
    const { copyAggregateId } = await seed(t);
    const completionId = await recordForAlice(t, copyAggregateId);
    const { sidecar } = await attachOne(t, completionId);
    const otherFileId = (await storeBlob(t)) as Id<"_storage">;
    await asAlice(t).mutation(
      api.solving.attachCompletionPhotos.attachCompletionPhotos,
      { completionId, storageIds: [otherFileId] },
    );

    // Backdate the sidecar so the updatedAt bump is observable.
    const staleAt = Date.now() - 10_000;
    await t.run((ctx) => ctx.db.patch(sidecar._id, { updatedAt: staleAt }));

    const cleanFileId = (await storeBlob(t)) as Id<"_storage">;
    await t.mutation(
      internal.solving.completionModerationStore.setModerationFile,
      { imageId: sidecar._id, fileId: cleanFileId },
    );

    const patched = await t.run((ctx) => ctx.db.get(sidecar._id));
    expect(patched?.fileId).toBe(cleanFileId);
    expect(patched?.moderationStatus).toBe("pending");
    expect(patched?.updatedAt).toBeGreaterThan(staleAt);

    // The completions.photos entry swapped old -> new IN PLACE; other entries untouched.
    const row = await completionRow(t, completionId);
    expect(row?.photos).toEqual([cleanFileId, otherFileId]);
  });

  test("a vanished sidecar is a no-op", async () => {
    const t = convexTest(schema, modules);
    const { copyAggregateId } = await seed(t);
    const completionId = await recordForAlice(t, copyAggregateId);
    const { fileId, sidecar } = await attachOne(t, completionId);
    await t.run((ctx) => ctx.db.delete(sidecar._id));

    const cleanFileId = (await storeBlob(t)) as Id<"_storage">;
    await t.mutation(
      internal.solving.completionModerationStore.setModerationFile,
      { imageId: sidecar._id, fileId: cleanFileId },
    );

    const row = await completionRow(t, completionId);
    expect(row?.photos).toEqual([fileId]);
  });
});

describe("completionModerationStore.setModerationVerdict", () => {
  test("approved records the verdict + score on the sidecar; photos untouched, no stamp", async () => {
    const t = convexTest(schema, modules);
    const { copyAggregateId } = await seed(t);
    const completionId = await recordForAlice(t, copyAggregateId);
    const { fileId, sidecar } = await attachOne(t, completionId);
    const staleAt = Date.now() - 10_000;
    await t.run((ctx) => ctx.db.patch(sidecar._id, { updatedAt: staleAt }));

    await t.mutation(
      internal.solving.completionModerationStore.setModerationVerdict,
      {
        imageId: sidecar._id,
        moderationStatus: "approved",
        moderationScore: 0.1,
        moderationLabel: "nsfw",
      },
    );

    const patched = await t.run((ctx) => ctx.db.get(sidecar._id));
    expect(patched?.moderationStatus).toBe("approved");
    expect(patched?.moderationScore).toBe(0.1);
    expect(patched?.moderationLabel).toBe("nsfw");
    expect(patched?.updatedAt).toBeGreaterThan(staleAt);

    const row = await completionRow(t, completionId);
    expect(row?.photos).toEqual([fileId]);
    expect(await moderationActions(t)).toHaveLength(0);
  });

  test("rejected drops the id from photos, deletes the blob, keeps the sidecar, stamps photo_auto_rejected", async () => {
    const t = convexTest(schema, modules);
    const { copyAggregateId } = await seed(t);
    const completionId = await recordForAlice(t, copyAggregateId);
    const { fileId: rejectedFileId, sidecar } = await attachOne(
      t,
      completionId,
    );
    const keptFileId = (await storeBlob(t)) as Id<"_storage">;
    await asAlice(t).mutation(
      api.solving.attachCompletionPhotos.attachCompletionPhotos,
      { completionId, storageIds: [keptFileId] },
    );

    await t.mutation(
      internal.solving.completionModerationStore.setModerationVerdict,
      {
        imageId: sidecar._id,
        moderationStatus: "rejected",
        moderationScore: 0.97,
        moderationLabel: "nsfw",
      },
    );

    // The photo left the completions row (frees a cap slot) and its blob is gone.
    const row = await completionRow(t, completionId);
    expect(row?.photos).toEqual([keptFileId]);
    expect(await t.run((ctx) => ctx.storage.getUrl(rejectedFileId))).toBeNull();
    expect(await t.run((ctx) => ctx.storage.getUrl(keptFileId))).not.toBeNull();

    // The sidecar survives for audit, carrying the verdict.
    const kept = await t.run((ctx) => ctx.db.get(sidecar._id));
    expect(kept?.moderationStatus).toBe("rejected");
    expect(kept?.moderationScore).toBe(0.97);

    // The automated decision is stamped against the completion aggregate, labeled via the
    // completion's copy snapshot title.
    const actions = await moderationActions(t);
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({
      kind: "photo_auto_rejected",
      targetId: completionId,
      targetLabel: "Mountain Vista",
    });
    expect(actions[0].actorId).toBeUndefined();
  });

  test("a re-run rejected verdict does not double-stamp", async () => {
    const t = convexTest(schema, modules);
    const { copyAggregateId } = await seed(t);
    const completionId = await recordForAlice(t, copyAggregateId);
    const { sidecar } = await attachOne(t, completionId);

    const reject = () =>
      t.mutation(
        internal.solving.completionModerationStore.setModerationVerdict,
        {
          imageId: sidecar._id,
          moderationStatus: "rejected",
          moderationScore: 0.97,
          moderationLabel: "nsfw",
        },
      );
    await reject();
    await reject();

    expect(await moderationActions(t)).toHaveLength(1);
  });
});

describe("rejected-photo read filtering", () => {
  // Seed a completion with 4 photos: approved, rejected, pending, and one WITHOUT a sidecar
  // (legacy). Statuses are patched directly so the filter itself is pinned — not the reject
  // cascade (which also removes the photo from the row).
  const seedStatuses = async (t: ReturnType<typeof convexTest>) => {
    const { copyAggregateId } = await seed(t);
    const completionId = await recordForAlice(t, copyAggregateId);
    const approved = (await storeBlob(t)) as Id<"_storage">;
    const rejected = (await storeBlob(t)) as Id<"_storage">;
    const pending = (await storeBlob(t)) as Id<"_storage">;
    await asAlice(t).mutation(
      api.solving.attachCompletionPhotos.attachCompletionPhotos,
      { completionId, storageIds: [approved, rejected, pending] },
    );
    // Let the background drain finish (it fail-open-approves all three) before pinning the
    // exact statuses, so none can be overwritten afterwards.
    await settleScheduledJobs(t);
    const images = await completionImagesFor(t, completionId);
    const byFile = new Map(images.map((img) => [img.fileId, img._id]));
    const legacy = (await storeBlob(t)) as Id<"_storage">;
    const row = await completionRow(t, completionId);
    await t.run(async (ctx) => {
      await ctx.db.patch(byFile.get(approved)!, {
        moderationStatus: "approved",
      });
      await ctx.db.patch(byFile.get(rejected)!, {
        moderationStatus: "rejected",
      });
      await ctx.db.patch(byFile.get(pending)!, {
        moderationStatus: "pending",
      });
      // `legacy` gets NO sidecar at all.
      await ctx.db.patch(row!._id, {
        photos: [approved, rejected, pending, legacy],
      });
    });
    const urlOf = (fileId: Id<"_storage">) =>
      t.run((ctx) => ctx.storage.getUrl(fileId));
    return {
      copyAggregateId,
      completionId,
      expectedUrls: [
        await urlOf(approved),
        await urlOf(pending),
        await urlOf(legacy),
      ],
    };
  };

  test("listMyCompletions excludes rejected only — pending and legacy-absent included", async () => {
    const t = convexTest(schema, modules);
    const { expectedUrls } = await seedStatuses(t);

    const mine = await asAlice(t).query(
      api.solving.listMyCompletions.listMyCompletions,
      {},
    );
    expect(mine).toHaveLength(1);
    expect(mine[0].photoUrls).toEqual(expectedUrls);
  });

  test("getCompletionHistory excludes rejected only — pending and legacy-absent included", async () => {
    const t = convexTest(schema, modules);
    const { copyAggregateId, expectedUrls } = await seedStatuses(t);

    const history = await asAlice(t).query(
      api.solving.getCompletionHistory.getCompletionHistory,
      { copyId: copyAggregateId },
    );
    expect(history).toHaveLength(1);
    expect(history[0].photoUrls).toEqual(expectedUrls);
  });

  test("a legacy completion without aggregateId keeps all photos", async () => {
    const t = convexTest(schema, modules);
    const { alice } = await seed(t);
    const fileId = (await storeBlob(t)) as Id<"_storage">;
    await t.run(async (ctx) => {
      const now = Date.now();
      await ctx.db.insert("completions", {
        userId: alice,
        startDate: now - 2 * HOUR,
        endDate: now - HOUR,
        photos: [fileId],
        isCompleted: true,
        createdAt: now,
        updatedAt: now,
      });
    });

    const mine = await asAlice(t).query(
      api.solving.listMyCompletions.listMyCompletions,
      {},
    );
    expect(mine).toHaveLength(1);
    expect(mine[0].photoUrls).toHaveLength(1);
    expect(mine[0].photoUrls[0]).not.toBeNull();
  });
});
